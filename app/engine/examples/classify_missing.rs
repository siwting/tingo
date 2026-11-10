//! Generate reviewable category proposals; never write to the meeting library.
use std::{path::Path, fs};
fn main() {
    let args: Vec<String> = std::env::args().collect();
    assert_eq!(args.len(), 3, "classify_missing <library> <new-output-json>");
    let output = Path::new(&args[2]);
    assert!(!output.exists());
    let cfg = tingo_engine::config::load(&tingo_engine::config::default_path());
    let mut proposals = Vec::new();
    for item in tingo_engine::meetings::list(Path::new(&args[1])) {
        if !item.tags.is_empty() || !item.has_minutes { continue; }
        let dir = Path::new(&args[1]).join(&item.id);
        let category = tingo_engine::workbench::meeting_categories(&dir, &cfg.llm).expect("classify meeting");
        eprintln!("{}: {:?}", item.id, category);
        proposals.push(serde_json::json!({"id":item.id,"category":category}));
    }
    fs::write(output, serde_json::to_vec_pretty(&proposals).unwrap()).unwrap();
}
