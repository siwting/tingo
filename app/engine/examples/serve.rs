//! 单独跑 Rust 后端（不带窗口），用来测接口和配合 `pnpm dev` 开发界面：
//! cargo run --release --example serve -- <模型目录> <录音组件> [端口]
#[tokio::main]
async fn main() {
    let a: Vec<String> = std::env::args().collect();
    if a.len() < 3 {
        eprintln!("Usage: serve <models-dir> <recorder-bin> [port]");
        std::process::exit(2);
    }
    let opt = tingo_engine::server::Options {
        root: tingo_engine::meetings::default_root(),
        config_path: tingo_engine::config::default_path(),
        models_dir: a[1].clone().into(),
        recorder_bin: a[2].clone().into(),
        version: env!("CARGO_PKG_VERSION").into(),
        // 示例会议的素材用仓库里的
        sample_dir: std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src/tingo/sample"),
    };
    let port = a.get(3).and_then(|p| p.parse().ok()).unwrap_or(0);
    let host = std::env::var("TINGO_WEB_HOST").unwrap_or_else(|_| "127.0.0.1".into());
    let desktop_api = a.iter().any(|s| s == "--desktop-api");
    if desktop_api && host != "127.0.0.1" {
        panic!("Development API must listen on loopback only");
    }
    let listener = tokio::net::TcpListener::bind((host.as_str(), port))
        .await
        .expect("监听端口");
    let port = listener.local_addr().unwrap().port();
    let web = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../src/tingo/web");
    if !web.join("index.html").is_file() {
        eprintln!("先在 app 目录运行 pnpm build");
        std::process::exit(2);
    }
    let router = if desktop_api {
        tingo_engine::server::router(tingo_engine::server::AppState::new(opt))
    } else {
        tingo_engine::server::reader_router(tingo_engine::server::AppState::reader(opt))
    };
    let router = router.fallback_service(tower_http::services::ServeDir::new(web));
    let server = async move {
        axum::serve(listener, router).await.expect("Web 服务");
    };
    println!("TINGO_PORT={port}");
    server.await;
}
