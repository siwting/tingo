//! Managed MLX runtime and downloadable models; Tingo retains decoding, VAD and speaker clustering.
use std::{
    io::{Read, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    time::{Duration, Instant},
};
use crate::asr::AsrKind;
use crate::i18n::tr;
pub fn model_dir(root: &Path, kind: AsrKind) -> PathBuf {
    if kind == AsrKind::QwenMlx {
        if let Some(path) = std::env::var_os("TINGO_MLX_MODEL") { return path.into(); }
    }
    root.join("mlx").join(kind.id())
}
pub fn python(root: &Path) -> PathBuf {
    if let Some(path) = std::env::var_os("TINGO_MLX_PYTHON") { return path.into(); }
    let settings = crate::workbench::read(&root.join("mlx-runtime.json")).unwrap_or_default();
    settings["python"].as_str().map(PathBuf::from).unwrap_or_else(|| root.join("runtime/venv/bin/python"))
}
pub fn ready_for(root: &Path, kind: AsrKind) -> bool {
    let dir = model_dir(root, kind);
    let external = kind == AsrKind::QwenMlx && std::env::var_os("TINGO_MLX_MODEL").is_some();
    python(root).is_file() && dir.join("config.json").is_file()
        && (external || dir.join("tingo-complete.json").is_file())
        && std::fs::read_dir(dir).ok().is_some_and(|files| files.flatten().any(|f| f.path().extension().is_some_and(|e| e == "safetensors")))
}
fn worker(root: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let path = root.join("mlx-worker.py");
    std::fs::write(&path, include_str!("../../../scripts/mlx_helper.py")).map_err(|e| e.to_string())?;
    Ok(path)
}
fn run_setup(mut cmd: Command, log: &Path) -> Result<(), String> {
    let file = std::fs::File::create(log).map_err(|e| e.to_string())?;
    cmd.stdout(file.try_clone().map_err(|e| e.to_string())?).stderr(file);
    #[cfg(unix)] { use std::os::unix::process::CommandExt; cmd.process_group(0); }
    let mut child = cmd.spawn().map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(3600);
    loop {
        match child.try_wait().map_err(|e| e.to_string())? {
            Some(status) if status.success() => return Ok(()),
            Some(_) => return Err(format!("{} {}", tr("安装或下载失败，详细日志：", "Install/download failed. Details:"), log.display())),
            None if Instant::now() < deadline => std::thread::sleep(Duration::from_millis(250)),
            _ => {
                #[cfg(unix)] unsafe { libc::kill(-(child.id() as i32), libc::SIGKILL); }
                let _ = child.kill(); let _ = child.wait(); return Err("MLX setup timed out; retry to resume".into());
            }
        }
    }
}
pub fn install(root: &Path, kind: AsrKind, mut stage: impl FnMut(&str)) -> Result<(), String> {
    if !cfg!(all(target_os = "macos", target_arch = "aarch64")) { return Err("MLX requires an Apple Silicon Mac".into()); }
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let log = root.join("mlx-install.log");
    let py = python(root);
    let managed = py == root.join("runtime/venv/bin/python");
    let runtime_ready = py.is_file() && Command::new(&py).args(["-c", "import mlx.core, mlx_audio, soundfile, huggingface_hub, sentencepiece; import mlx_audio.stt.models.sensevoice, mlx_audio.stt.models.fun_asr_nano"]).stdout(Stdio::null()).stderr(Stdio::null()).status().is_ok_and(|s| s.success());
    if !runtime_ready && !managed { return Err("Configured MLX Python is unavailable or missing dependencies".into()); }
    if !runtime_ready {
        stage(tr("准备 MLX 运行环境…", "Preparing MLX runtime…"));
        let bootstrap = root.join("runtime/bootstrap");
        let uv = bootstrap.join("bin/uv");
        if !uv.is_file() {
            let mut command = Command::new("/usr/bin/python3");
            command.args(["-m", "pip", "install", "--disable-pip-version-check", "--target"]).arg(&bootstrap).arg("uv");
            run_setup(command, &log)?;
        }
        if !py.is_file() {
        let mut command = Command::new(&uv);
        command.env("UV_PYTHON_INSTALL_DIR",root.join("runtime/python")).env("UV_CACHE_DIR",root.join("runtime/cache"))
            .args(["venv", "--python", "3.12"]).arg(root.join("runtime/venv"));
        run_setup(command, &log)?;
        }
        let mut command = Command::new(&uv);
        command.env("UV_CACHE_DIR",root.join("runtime/cache")).args(["pip","install","--python"]).arg(&py)
            .args(["mlx-audio==0.6.1", "soundfile", "huggingface_hub", "sentencepiece"]);
        run_setup(command, &log)?;
    }
    // Also detect an interrupted environment installation before treating it as usable.
    let mut check = Command::new(&py);
    check.args(["-c", "import mlx.core, mlx_audio, soundfile, huggingface_hub, sentencepiece; import mlx_audio.stt.models.sensevoice, mlx_audio.stt.models.fun_asr_nano"]);
    run_setup(check, &log)?;
    if ready_for(root, kind) { return Ok(()); }
    stage(tr("正在下载 MLX 模型（可断点续传）…", "Downloading MLX model (resumable)…"));
    let repo = match kind {
        AsrKind::QwenMlx => "mlx-community/Qwen3-ASR-0.6B-8bit",
        AsrKind::QwenMlx17 => "mlx-community/Qwen3-ASR-1.7B-8bit",
        AsrKind::SenseVoiceMlx => "mlx-community/SenseVoiceSmall",
        AsrKind::FunAsrNanoMlx => "mlx-community/Fun-ASR-Nano-2512",
        _ => return Err("Not an MLX model".into()),
    };
    let mut command = Command::new(&py);
    // Standard HTTPS range downloads work with system proxies and resume partial files.
    command.env("HF_HUB_DISABLE_XET", "1").arg(worker(root)?).arg("--download").arg(repo).arg(model_dir(root,kind));
    run_setup(command, &log)?;
    if !ready_for(root,kind) { return Err("MLX download incomplete".into()); }
    Ok(())
}
pub fn transcribe(
    root: &Path,
    kind: AsrKind,
    language: &str,
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
    let mut command = if let Some(helper) = std::env::var_os("TINGO_MLX_HELPER") {
        Command::new(helper)
    } else {
        let mut c = Command::new(python(root)); c.arg(worker(root)?); c
    };
    let mut child = command.env("TINGO_MLX_MODEL", model_dir(root,kind))
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null())
        .spawn().map_err(|e| e.to_string())?;
    let request = serde_json::to_vec(
        &serde_json::json!({"audio":path.0,"hotwords":hotwords,"ranges":ranges,"language":language}),
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
