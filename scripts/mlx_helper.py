#!/usr/bin/env python3
"""Managed multi-model MLX worker and explicit model downloader.
Input/output is JSON, audio never leaves this process. No implicit model download.
"""
import contextlib
import json
import os
import sys
from pathlib import Path


def timed_chunks(audio, rate, split):
    """Keep inference padding out of timestamps, which describe source audio."""
    duration = len(audio) / rate
    for chunk, offset in split(audio, rate, chunk_duration=60):
        end = min(duration, offset + len(chunk) / rate)
        if offset < end:
            yield chunk, offset, end


def main():
    request = json.load(sys.stdin)
    model_path = Path(os.environ.get('TINGO_MLX_MODEL', ''))
    if not model_path.is_dir() or not (model_path / 'config.json').is_file():
        raise ValueError('Set TINGO_MLX_MODEL to a downloaded MLX model')
    with contextlib.redirect_stdout(sys.stderr):
        import mlx.core as mx
        import soundfile as sf
        from mlx_audio.stt.utils import load_model
        from mlx_audio.stt.models.qwen3_asr.qwen3_asr import split_audio_into_chunks
        if not mx.metal.is_available():
            raise RuntimeError('MLX requires Apple Silicon Metal')
        mx.set_default_device(mx.gpu)
        model_type = json.loads((model_path / 'config.json').read_text()).get('model_type')
        model = load_model(str(model_path))
        samples, rate = sf.read(request['audio'], dtype='float32')
        if rate != 16000 or samples.ndim != 1:
            raise ValueError('Expected 16 kHz mono audio')
        spans = []
        ranges = request.get('ranges', [[0, len(samples)/rate]])
        for start, end in ranges:
            if not 0 <= start <= end <= len(samples)/rate + 0.01:
                raise ValueError('Invalid VAD range')
            audio = samples[round(start*rate):round(end*rate)]
            for chunk, offset, chunk_end in timed_chunks(audio, rate, split_audio_into_chunks):
                result = model.generate(chunk, max_tokens=2048, language=(request.get('language') or 'auto') if model_type == 'sensevoice' else {'zh':'Chinese','en':'English'}.get(request.get('language')), verbose=False, hotwords=request.get('hotwords', []))
                spans.append({'start': float(start+offset), 'end': float(min(end, start+chunk_end)), 'text': result.text.strip()})
    json.dump(spans, sys.stdout, ensure_ascii=False)

def download(repo, destination):
    from huggingface_hub import snapshot_download
    allowed = {'mlx-community/Qwen3-ASR-0.6B-8bit', 'mlx-community/Qwen3-ASR-1.7B-8bit', 'mlx-community/SenseVoiceSmall', 'mlx-community/Fun-ASR-Nano-2512'}
    if repo not in allowed:
        raise ValueError('Unsupported MLX repository')
    dest = Path(destination)
    snapshot_download(repo_id=repo, local_dir=dest, allow_patterns=['*.json', '*.safetensors', '*.txt', '*.model', '*.mvn'])
    if not (dest / 'config.json').is_file() or not list(dest.glob('*.safetensors')):
        raise ValueError('Incomplete MLX model')
    required = {
        'mlx-community/SenseVoiceSmall': ['am.mvn', 'chn_jpn_yue_eng_ko_spectok.bpe.model'],
        'mlx-community/Fun-ASR-Nano-2512': ['Qwen3-0.6B/tokenizer.json', 'Qwen3-0.6B/tokenizer_config.json'],
    }.get(repo, [])
    if any(not (dest / name).is_file() for name in required):
        raise ValueError('Incomplete MLX preprocessing/tokenizer files')
    marker = dest / 'tingo-complete.json'
    temporary = marker.with_suffix('.tmp')
    temporary.write_text(json.dumps({'repository': repo}))
    temporary.replace(marker)

if __name__ == '__main__':
    if len(sys.argv) == 4 and sys.argv[1] == '--download':
        download(sys.argv[2], sys.argv[3])
    else:
        main()
