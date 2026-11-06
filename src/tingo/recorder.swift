// tingo-recorder：用 ScreenCaptureKit 录系统声音和麦克风，也负责把音视频解码成 16 kHz wav。
// 编译时最低系统设为 macOS 13（和 App 一致）。ScreenCaptureKit 录麦克风要 macOS 15，
// 更早的系统改用 AVAudioEngine 录麦克风；只录麦克风时不碰 ScreenCaptureKit，也就不需要录屏权限。
//
// 录音：tingo-recorder <输出目录> [--no-mic] [--no-system]
//   输出 <目录>/system.wav、<目录>/mic.wav；收到 SIGINT/SIGTERM 后收尾退出。
//   向 stdout 打印一行状态：READY 表示已开始录音，ERROR: … 表示失败。
// 解码：tingo-recorder decode <输入文件> <输出.wav>
//   用系统的 AVFoundation 解码 m4a/mp3/wav/aac/flac/mp4/mov 等，输出 16 kHz 单声道 16 位 wav；成功打印 OK。
// 导出 PDF：tingo-recorder pdf <输入.html> <输出.pdf>
//   用系统的 WebKit 排版，A4 分页；成功打印 OK。
// 移到废纸篓：tingo-recorder trash <路径>
//   文件或文件夹都行，可以从废纸篓里恢复；成功打印 OK。

import AppKit
import AVFoundation
import Foundation
import ScreenCaptureKit
import WebKit
import Speech

final class Track {
    let url: URL
    var file: AVAudioFile?
    var framesWritten: AVAudioFramePosition = 0

    init(url: URL) { self.url = url }
}

/// macOS 15 以前录麦克风：AVAudioEngine 取输入，转成 48 kHz 单声道 float，和 ScreenCaptureKit 录出来的格式一致
final class MicEngine {
    let engine = AVAudioEngine()
    let track: Track
    let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 48000, channels: 1, interleaved: false)!

    init(track: Track) { self.track = track }

    func start() throws {
        let input = engine.inputNode
        let inFormat = input.outputFormat(forBus: 0)
        guard inFormat.sampleRate > 0, let converter = AVAudioConverter(from: inFormat, to: format) else {
            throw NSError(domain: "tingo", code: 2, userInfo: [NSLocalizedDescriptionKey: "找不到麦克风"])
        }
        track.file = try AVAudioFile(forWriting: track.url, settings: format.settings,
                                     commonFormat: format.commonFormat, interleaved: false)
        let out = format
        let ratio = out.sampleRate / inFormat.sampleRate
        input.installTap(onBus: 0, bufferSize: 4096, format: inFormat) { [weak self] buf, _ in
            guard let self, let file = self.track.file else { return }
            let cap = AVAudioFrameCount(Double(buf.frameLength) * ratio) + 16
            guard let pcm = AVAudioPCMBuffer(pcmFormat: out, frameCapacity: cap) else { return }
            var fed = false
            var err: NSError?
            converter.convert(to: pcm, error: &err) { _, status in
                if fed {
                    status.pointee = .noDataNow
                    return nil
                }
                fed = true
                status.pointee = .haveData
                return buf
            }
            if err == nil && pcm.frameLength > 0 {
                do {
                    try file.write(from: pcm)
                    self.track.framesWritten += AVAudioFramePosition(pcm.frameLength)
                } catch {
                    fail("写入音频失败：\(error.localizedDescription)")
                }
            }
        }
        try engine.start()
    }

    func stop() {
        engine.inputNode.removeTap(onBus: 0)
        engine.stop()
        track.file = nil
    }
}

final class Recorder: NSObject, SCStreamOutput, SCStreamDelegate {
    let system: Track
    let mic: Track
    let withMic: Bool
    let withSystem: Bool
    let queue = DispatchQueue(label: "tingo.recorder")
    var stream: SCStream?
    var t0: CMTime?
    var micEngine: MicEngine?

    /// 麦克风走 ScreenCaptureKit（macOS 15+）还是 AVAudioEngine。TINGO_MIC_ENGINE=1 强制用后者，方便在新系统上测试
    var micViaStream: Bool {
        guard withSystem, ProcessInfo.processInfo.environment["TINGO_MIC_ENGINE"] != "1" else { return false }
        if #available(macOS 15.0, *) { return true }
        return false
    }

    init(outDir: URL, withMic: Bool, withSystem: Bool) {
        system = Track(url: outDir.appendingPathComponent("system.wav"))
        mic = Track(url: outDir.appendingPathComponent("mic.wav"))
        self.withMic = withMic
        self.withSystem = withSystem
    }

    func start() async throws {
        if withMic && !micViaStream {
            let engine = MicEngine(track: mic)
            try engine.start()
            micEngine = engine
        }
        guard withSystem else { return }
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: false)
        guard let display = content.displays.first else {
            throw NSError(domain: "tingo", code: 1, userInfo: [NSLocalizedDescriptionKey: "找不到显示器"])
        }
        let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
        let cfg = SCStreamConfiguration()
        cfg.capturesAudio = withSystem
        cfg.excludesCurrentProcessAudio = true
        cfg.sampleRate = 48000
        cfg.channelCount = 1
        // 只要声音，画面压到最小
        cfg.width = 2
        cfg.height = 2
        cfg.minimumFrameInterval = CMTime(value: 1, timescale: 1)
        if #available(macOS 15.0, *), withMic && micViaStream {
            cfg.captureMicrophone = true
            cfg.microphoneCaptureDeviceID = AVCaptureDevice.default(for: .audio)?.uniqueID
        }

        let s = SCStream(filter: filter, configuration: cfg, delegate: self)
        try s.addStreamOutput(self, type: .screen, sampleHandlerQueue: queue)
        if withSystem {
            try s.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
        }
        if #available(macOS 15.0, *), withMic && micViaStream {
            try s.addStreamOutput(self, type: .microphone, sampleHandlerQueue: queue)
        }
        try await s.startCapture()
        stream = s
    }

    func stop() async {
        try? await stream?.stopCapture()
        micEngine?.stop()
        queue.sync {
            system.file = nil
            mic.file = nil
        }
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sb: CMSampleBuffer, of type: SCStreamOutputType) {
        let track: Track
        if type == .audio {
            track = system
        } else if #available(macOS 15.0, *), type == .microphone {
            track = mic
        } else {
            return
        }
        guard sb.isValid, let desc = sb.formatDescription,
              var asbd = desc.audioStreamBasicDescription,
              let format = AVAudioFormat(streamDescription: &asbd)
        else { return }

        do {
            if track.file == nil {
                track.file = try AVAudioFile(
                    forWriting: track.url, settings: format.settings,
                    commonFormat: format.commonFormat, interleaved: format.isInterleaved)
            }
            guard let file = track.file else { return }

            // 两条音轨按同一个起点对齐；中间没有数据的空档补静音，避免两路错位
            let pts = sb.presentationTimeStamp
            if t0 == nil { t0 = pts }
            let expected = AVAudioFramePosition(CMTimeGetSeconds(CMTimeSubtract(pts, t0!)) * format.sampleRate)
            let gap = expected - track.framesWritten
            if gap > AVAudioFramePosition(format.sampleRate / 10) {
                try writeSilence(file: file, format: format, frames: gap)
                track.framesWritten += gap
            }

            try sb.withAudioBufferList { abl, _ in
                guard let pcm = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: abl.unsafePointer) else { return }
                try file.write(from: pcm)
                track.framesWritten += AVAudioFramePosition(pcm.frameLength)
            }
        } catch {
            fail("写入音频失败：\(error.localizedDescription)")
        }
    }

    func writeSilence(file: AVAudioFile, format: AVAudioFormat, frames: AVAudioFramePosition) throws {
        var left = frames
        while left > 0 {
            let n = AVAudioFrameCount(min(left, 48000))
            guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: n) else { return }
            buf.frameLength = n  // 新分配的缓冲区内容为 0，即静音
            try file.write(from: buf)
            left -= AVAudioFramePosition(n)
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) {
        fail("录音中断：\(error.localizedDescription)")
    }
}

func fail(_ msg: String) -> Never {
    print("ERROR: \(msg)")
    fflush(stdout)
    exit(1)
}

/// 解码任意音视频为 16 kHz 单声道 16 位 PCM wav。
func decode(_ input: String, _ output: String) -> Never {
    let asset = AVURLAsset(url: URL(fileURLWithPath: input))
    let done = DispatchSemaphore(value: 0)
    var tracks: [AVAssetTrack] = []
    Task {
        tracks = (try? await asset.loadTracks(withMediaType: .audio)) ?? []
        done.signal()
    }
    done.wait()
    guard !tracks.isEmpty else { fail("文件里没有可识别的音频（支持 m4a、mp3、wav、mp4、mov 等）：\(input)") }
    guard let reader = try? AVAssetReader(asset: asset) else { fail("无法读取：\(input)") }
    let settings: [String: Any] = [
        AVFormatIDKey: kAudioFormatLinearPCM, AVSampleRateKey: 16000, AVNumberOfChannelsKey: 1,
        AVLinearPCMBitDepthKey: 16, AVLinearPCMIsFloatKey: false, AVLinearPCMIsBigEndianKey: false,
        AVLinearPCMIsNonInterleaved: false,
    ]
    let out = AVAssetReaderAudioMixOutput(audioTracks: tracks, audioSettings: settings)
    reader.add(out)
    guard reader.startReading() else { fail("解码失败：\(reader.error?.localizedDescription ?? "")") }
    var pcm = Data()
    while let sb = out.copyNextSampleBuffer() {
        guard let block = CMSampleBufferGetDataBuffer(sb) else { continue }
        let len = CMBlockBufferGetDataLength(block)
        var chunk = Data(count: len)
        chunk.withUnsafeMutableBytes { _ = CMBlockBufferCopyDataBytes(block, atOffset: 0, dataLength: len, destination: $0.baseAddress!) }
        pcm.append(chunk)
    }
    guard reader.status == .completed else { fail("解码中断：\(reader.error?.localizedDescription ?? "")") }
    var wav = Data()
    func u32(_ v: UInt32) { withUnsafeBytes(of: v.littleEndian) { wav.append(contentsOf: $0) } }
    func u16(_ v: UInt16) { withUnsafeBytes(of: v.littleEndian) { wav.append(contentsOf: $0) } }
    wav.append(contentsOf: Array("RIFF".utf8)); u32(UInt32(36 + pcm.count)); wav.append(contentsOf: Array("WAVEfmt ".utf8))
    u32(16); u16(1); u16(1); u32(16000); u32(32000); u16(2); u16(16)
    wav.append(contentsOf: Array("data".utf8)); u32(UInt32(pcm.count))
    wav.append(pcm)
    do { try wav.write(to: URL(fileURLWithPath: output)) } catch { fail("写入失败：\(error.localizedDescription)") }
    print("OK")
    exit(0)
}

/// HTML → PDF：WKWebView 加载完后走系统打印，打印目标设成文件。打印要求视图在窗口里，所以放进一个不显示的窗口。
final class PDFExporter: NSObject, WKNavigationDelegate {
    let web: WKWebView
    let window: NSWindow
    let output: URL

    init(output: URL) {
        self.output = output
        let frame = NSRect(x: 0, y: 0, width: 660, height: 934) // A4 可打印宽度 495pt ≈ 660px，CSS 像素按 0.75pt 落到纸上
        web = WKWebView(frame: frame)
        window = NSWindow(contentRect: frame, styleMask: [.borderless], backing: .buffered, defer: false)
        super.init()
        window.contentView = web
        web.navigationDelegate = self
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // 等字体和布局稳定
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.print() }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        fail("排版失败：\(error.localizedDescription)")
    }

    func print() {
        let info = NSPrintInfo()
        info.paperSize = NSSize(width: 595.28, height: 841.89) // A4，单位 pt
        info.topMargin = 46
        info.bottomMargin = 46
        info.leftMargin = 50
        info.rightMargin = 50
        info.horizontalPagination = .fit
        info.verticalPagination = .automatic
        info.isHorizontallyCentered = false
        info.isVerticallyCentered = false
        info.jobDisposition = .save
        info.dictionary()[NSPrintInfo.AttributeKey.jobSavingURL] = output
        let op = web.printOperation(with: info)
        op.showsPrintPanel = false
        op.showsProgressPanel = false
        op.view?.frame = web.bounds // 不设的话 WebKit 打出来是空白页
        op.runModal(for: window, delegate: self, didRun: #selector(done(_:success:contextInfo:)), contextInfo: nil)
    }

    @objc func done(_ op: NSPrintOperation, success: Bool, contextInfo: UnsafeMutableRawPointer?) {
        if success && FileManager.default.fileExists(atPath: output.path) {
            Swift.print("OK")
            exit(0)
        }
        fail("导出 PDF 失败")
    }
}

func exportPDF(_ input: String, _ output: String) -> Never {
    guard let html = try? String(contentsOfFile: input, encoding: .utf8) else { fail("读不了 \(input)") }
    let app = NSApplication.shared
    app.setActivationPolicy(.prohibited) // 不出现在 Dock
    let exporter = PDFExporter(output: URL(fileURLWithPath: output).absoluteURL)
    exporter.web.loadHTMLString(html, baseURL: URL(fileURLWithPath: input).deletingLastPathComponent())
    DispatchQueue.main.asyncAfter(deadline: .now() + 30) { fail("排版超时") }
    withExtendedLifetime(exporter) { app.run() }
    exit(1)
}


// System speech commands share the app identity and never record from the microphone.
#if compiler(>=6.2)
@available(macOS 26.0, *)
func appleSpeech(_ args: [String]) async throws {
    guard SpeechTranscriber.isAvailable else { throw NSError(domain: "tingo", code: 1, userInfo: [NSLocalizedDescriptionKey: "Apple 系统识别在此设备不可用 / Apple speech is unavailable on this device"]) }
    let language = args.count > 2 ? args[2] : "zh"
    guard language == "zh" || language == "en" else { throw NSError(domain: "tingo", code: 2, userInfo: [NSLocalizedDescriptionKey: "Apple 系统识别请明确选择中文或英文 / Select Chinese or English for Apple speech"]) }
    guard let locale = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: language == "en" ? "en_US" : "zh_CN")) else { throw NSError(domain: "tingo", code: 3, userInfo: [NSLocalizedDescriptionKey: "系统不支持所选语言 / Unsupported speech language"]) }
    let transcriber = SpeechTranscriber(locale: locale, transcriptionOptions: [], reportingOptions: [], attributeOptions: [.audioTimeRange])
    if args[1] == "speech-status" {
        let installed = await SpeechTranscriber.installedLocales
        let data = try JSONSerialization.data(withJSONObject: ["available": true, "ready": installed.contains(locale), "locale": locale.identifier])
        print(String(decoding: data, as: UTF8.self)); return
    }
    if args[1] == "speech-install" {
        if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) { try await request.downloadAndInstall() }
        print("OK"); return
    }
    guard args.count > 3 else { throw NSError(domain: "tingo", code: 4, userInfo: [NSLocalizedDescriptionKey: "Missing audio file"]) }
    guard await SpeechTranscriber.installedLocales.contains(locale) else { throw NSError(domain: "tingo", code: 5, userInfo: [NSLocalizedDescriptionKey: "请先在设置中安装系统语音模型 / Install the system speech model in Settings first"]) }
    let results = Task { () throws -> [[String: Any]] in
        var rows: [[String: Any]] = []
        for try await r in transcriber.results {
            rows.append(["start": r.range.start.seconds, "end": CMTimeRangeGetEnd(r.range).seconds, "text": String(r.text.characters)])
        }
        return rows
    }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let file = try AVAudioFile(forReading: URL(fileURLWithPath: args[3]))
    _ = try await analyzer.analyzeSequence(from: file)
    try await analyzer.finalizeAndFinishThroughEndOfInput()
    let data = try JSONSerialization.data(withJSONObject: try await results.value)
    print(String(decoding: data, as: UTF8.self))
}

#endif

let args = CommandLine.arguments
if args.count >= 2 && args[1] == "choose-directory" {
    let app = NSApplication.shared
    app.setActivationPolicy(.accessory)
    app.activate(ignoringOtherApps: true)
    let panel = NSOpenPanel()
    panel.canChooseFiles = false
    panel.canChooseDirectories = true
    panel.canCreateDirectories = true
    panel.allowsMultipleSelection = false
    if args.count > 2 { panel.directoryURL = URL(fileURLWithPath: args[2]) }
    let path = panel.runModal() == .OK ? panel.url?.path : nil
    let data = try! JSONSerialization.data(withJSONObject: ["path": path as Any? ?? NSNull()])
    print(String(decoding: data, as: UTF8.self))
    exit(0)
}

if args.count >= 2 && ["speech-status", "speech-install", "speech-transcribe"].contains(args[1]) {
    #if compiler(>=6.2)
    if #available(macOS 26.0, *) {
        Task {
            do { try await appleSpeech(args); fflush(stdout); exit(0) }
            catch { fail(error.localizedDescription) }
        }
        dispatchMain()
    } else { fail("Apple 系统识别需要 macOS 26 或更新版本 / Apple speech requires macOS 26 or later") }
    #else
    fail("此构建未启用 Apple Speech，请使用新版安装包 / Apple Speech requires a build made with Xcode 26 or later")
    #endif
}

if args.count >= 4 && args[1] == "decode" { decode(args[2], args[3]) }
if args.count >= 4 && args[1] == "pdf" { exportPDF(args[2], args[3]) }
if args.count >= 3 && args[1] == "trash" {
    do {
        try FileManager.default.trashItem(at: URL(fileURLWithPath: args[2]), resultingItemURL: nil)
        print("OK")
        exit(0)
    } catch {
        fail("移到废纸篓失败：\(error.localizedDescription)")
    }
}
guard args.count >= 2 else { fail("用法：tingo-recorder <输出目录> [--no-mic] [--no-system]，或 tingo-recorder decode <输入> <输出.wav>") }
let outDir = URL(fileURLWithPath: args[1])
try? FileManager.default.createDirectory(at: outDir, withIntermediateDirectories: true)
let recorder = Recorder(outDir: outDir, withMic: !args.contains("--no-mic"), withSystem: !args.contains("--no-system"))

signal(SIGINT, SIG_IGN)
signal(SIGTERM, SIG_IGN)
var stopSources: [DispatchSourceSignal] = []
for sig in [SIGINT, SIGTERM] {
    let src = DispatchSource.makeSignalSource(signal: sig, queue: .main)
    src.setEventHandler {
        Task {
            await recorder.stop()
            print("STOPPED")
            fflush(stdout)
            exit(0)
        }
    }
    src.resume()
    stopSources.append(src)
}

Task {
    do {
        try await recorder.start()
        print("READY")
        fflush(stdout)
    } catch {
        let ns = error as NSError
        if ns.domain == SCStreamErrorDomain && ns.code == SCStreamError.userDeclined.rawValue {
            fail("没有录屏与系统录音权限：系统设置 → 隐私与安全性 → 屏幕与系统录音，勾选你的终端后重启终端")
        }
        fail(error.localizedDescription)
    }
}

dispatchMain()
