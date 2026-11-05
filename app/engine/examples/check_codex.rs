//! Explicit live provider smoke test using synthetic text only.
fn main() {
    let claude = std::env::args().any(|a| a == "--claude");
    let chat = if claude {
        tingo_engine::codex::claude_chat
    } else {
        tingo_engine::codex::chat
    };
    let result = chat(
        "只根据给定的合成会议材料回答，不使用工具。",
        "合成会议：小林负责周五核对测试报告。谁负责核对？只回答名字。",
        "",
    )
    .expect("Codex provider call");
    assert!(result.contains("小林"), "Unexpected provider response");
    println!(
        "PASS: native {} text provider",
        if claude { "Claude Code" } else { "Codex" }
    );
}
