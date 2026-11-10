// 发布版不弹终端窗口（Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(all(not(debug_assertions), not(feature = "custom-protocol")))]
compile_error!("Desktop release builds require --features custom-protocol (or use tauri build) to embed the frontend.");

fn main() {
    tingo_lib::run()
}
