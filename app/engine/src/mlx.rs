//! Optional external MLX worker; Tingo retains decoding, VAD and speaker clustering.
use std::{
    io::{Read, Write},
    path::PathBuf,
    process::{Command, Stdio},
    time::{Duration, Instant},
};
pub fn ready() -> bool {
    std::env::var_os("TINGO_MLX_HELPER").is_some_and(|p| PathBuf::from(p).is_file())
        && std::env::var_os("TINGO_MLX_MODEL")
            .is_some_and(|p| PathBuf::from(p).join("config.json").is_file())
}
pub fn transcribe(
    samples: &[f32],
    hotwords: &[String],
    ranges: &[(f64, f64)],
) -> Result<Vec<crate::apple_speech::Span>, String> {
    static NEXT: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
    struct Temp(PathBuf);
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }
    let path = Temp(std::env::temp_dir().join(format!(
        "tingo-mlx-{}-{}.wav",
        std::process::id(),
        NEXT.fetch_add(1, std::sync::atomic::Ordering::Relaxed)
    )));
    crate::record::write_wav16(&path.0, samples).map_err(|e| e.to_string())?;
    let helper = std::env::var_os("TINGO_MLX_HELPER").ok_or("Configure TINGO_MLX_HELPER")?;
    let mut child = Command::new(helper)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| e.to_string())?;
    let request = serde_json::to_vec(
        &serde_json::json!({"audio":path.0,"hotwords":hotwords,"ranges":ranges}),
    )
    .map_err(|e| e.to_string())?;
    let mut stdin = child.stdin.take().unwrap();
    let writer = std::thread::spawn(move || stdin.write_all(&request));
    let mut stdout = child.stdout.take().unwrap();
    let reader = std::thread::spawn(move || {
        let mut text = String::new();
        stdout.read_to_string(&mut text).map(|_| text)
    });
    let deadline = Instant::now() + Duration::from_secs(300);
    let status = loop {
        match child.try_wait() {
            Ok(Some(s)) => break s,
            Ok(None) if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(100)),
            _ => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = writer.join();
                let _ = reader.join();
                return Err("MLX worker timeout".into());
            }
        }
    };
    writer
        .join()
        .map_err(|_| "MLX input failed")?
        .map_err(|e| e.to_string())?;
    let text = reader
        .join()
        .map_err(|_| "MLX output failed")?
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("MLX worker failed; check Python dependencies and model configuration".into());
    }
    let spans: Vec<crate::apple_speech::Span> =
        serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let duration = samples.len() as f64 / 16000.;
    if spans.iter().any(|s| {
        !s.start.is_finite()
            || !s.end.is_finite()
            || s.start < 0.
            || s.end < s.start
            || s.end > duration + 0.5
    }) {
        return Err("MLX returned invalid timestamps".into());
    }
    Ok(spans)
}
