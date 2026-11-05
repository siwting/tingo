//! Explicit smoke test: prepares shared native speech models, then runs MLX on a supplied WAV.
fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.iter().any(|a| a == "--install") {
        tingo_engine::mlx::install(std::path::Path::new(&args[1]), tingo_engine::asr::AsrKind::QwenMlx, |stage| eprintln!("{stage}")).expect("managed MLX install");
    }
    let paths = tingo_engine::asr::ModelPaths::new(&args[1]);
    tingo_engine::models::ensure_model(&paths, tingo_engine::asr::AsrKind::QwenMlx, |_, _| {})
        .expect("shared models");
    let engine = tingo_engine::asr::Engine::load(
        &paths,
        tingo_engine::asr::AsrKind::QwenMlx,
        &["注册转化".into()],
        "zh",
        4,
    )
    .expect("MLX engine");
    let audio = tingo_engine::audio::read_wav16k(std::path::Path::new(&args[2])).expect("WAV");
    let tr = tingo_engine::chunked::transcribe_samples(
        &engine,
        &audio,
        std::path::Path::new(&args[2]),
        |_| {},
    )
    .expect("native MLX transcription");
    assert!(!tr.sentences.is_empty());
    println!("{}", tr.to_prompt_text());
    println!("PASS: native decode/VAD/MLX/CAM++/clustering pipeline");
}
