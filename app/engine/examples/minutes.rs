//! 用当前配置的大模型给一份 transcript.json 生成纪要：cargo run --example minutes -- <transcript.json> [热词,逗号分隔]
use tingo_engine::{config, summarize, transcript::Transcript};
use std::io::Write;

fn main() {
    let a: Vec<String> = std::env::args().collect();
    let tr = Transcript::load(std::path::Path::new(&a[1])).unwrap();
    let cfg = config::load(&config::default_path());
    let hot: Vec<String> = a
        .get(2)
        .map(|s| s.split(',').map(String::from).collect())
        .unwrap_or_default();
    eprintln!("模型 {} @ {}", cfg.llm.model, cfg.llm.base_url);
    let t = std::time::Instant::now();
    let mut tokens = 0;
    let out = summarize::summarize(
        &tr,
        &cfg.llm,
        chrono::NaiveDate::from_ymd_opt(2026, 11, 2).unwrap(),
        &hot,
        &[],
        &cfg.minutes_language,
        summarize::Hooks {
            on_token: &mut |_t| {
                tokens += 1;
            },
            on_stage: &mut |s| eprintln!("{s}"),
            on_think: &mut |_| {},
        },
    )
    .unwrap();
    eprintln!("{:.1}s，流式片段 {tokens} 个", t.elapsed().as_secs_f64());
    std::io::stdout().write_all(out.as_bytes()).unwrap();
}
