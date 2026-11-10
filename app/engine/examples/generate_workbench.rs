//! Generate reviewable workbench data without modifying the meeting library.
//! Usage: generate_workbench <meeting-directory> <output-json>
use std::path::Path;
fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert_eq!(args.len(), 3, "expected meeting directory and new output file");
    let folder = Path::new(&args[1]);
    let output = Path::new(&args[2]);
    assert!(!output.exists(), "output already exists");
    let cfg = tingo_engine::config::load(&tingo_engine::config::default_path());
    let tasks = tingo_engine::workbench::extract_tasks(folder, &cfg.llm).expect("extract tasks");
    eprintln!("Validated {} tasks", tasks.len());
    let insights = tingo_engine::workbench::meeting_insights(folder, &cfg.llm).expect("meeting analysis");
    std::fs::write(output, serde_json::to_vec_pretty(&serde_json::json!({"tasks":tasks,"insights":insights})).unwrap()).unwrap();
    eprintln!("Saved review output: {}", output.display());
}
