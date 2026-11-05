"""Real HTTP tests against Rust + a deterministic local LLM fixture; no user data."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import threading
import unittest
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[2]

class LLM(BaseHTTPRequestHandler):
    def log_message(self, *_): pass
    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        if 'messages' not in body:
            self.send_response(404); self.end_headers(); return
        prompt = body['messages'][-1]['content']
        evidence = json.loads(prompt.split('资料：', 1)[1]) if '资料：' in prompt else []
        text = json.dumps({'answer': '测试回答', 'citations': ([{'id': evidence[0]['id'], 'quote': evidence[0]['text']}, {'id': 999999, 'quote': '编造内容'}] if evidence else [])}, ensure_ascii=False)
        self.send_response(200); self.send_header('Content-Type','text/event-stream'); self.end_headers()
        self.wfile.write(('data: '+json.dumps({'choices':[{'delta':{'content':text}}]},ensure_ascii=False)+'\n\ndata: [DONE]\n\n').encode())

class NativeWorkbench(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory(prefix='tingo-http-')
        cls.root = Path(cls.tmp.name)
        cls.meeting = cls.root/'2026-11-05_1200_合成测试'
        cls.meeting.mkdir()
        cls.transcript = {'source':'synthetic.wav','duration_ms':1000,'speaker_names':{},'sentences':[{'speaker':0,'start_ms':0,'end_ms':1000,'text':'西华将在周五完成核对。'}]}
        (cls.meeting/'transcript.json').write_text(json.dumps(cls.transcript))
        (cls.meeting/'纪要.md').write_text('# 合成测试\n西华负责核对。')
        cls.llm = ThreadingHTTPServer(('127.0.0.1',0),LLM)
        threading.Thread(target=cls.llm.serve_forever,daemon=True).start()
        config=cls.root/'config.toml'
        config.write_text(f'[llm]\nbase_url="http://127.0.0.1:{cls.llm.server_port}/v1"\napi_key="test-only"\nmodel="fixture"\n')
        env={**os.environ,'TINGO_ROOT':str(cls.root),'TINGO_CONFIG':str(config)}
        env.pop('TINGO_MLX_HELPER',None);env.pop('TINGO_MLX_MODEL',None)
        binary=ROOT/'app/engine/target/debug/examples/serve'
        cls.process=subprocess.Popen([str(binary),str(cls.root/'models'),'/usr/bin/false','0','--desktop-api'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        line=cls.process.stdout.readline().strip()
        if not line.startswith('TINGO_PORT='): raise RuntimeError(line+cls.process.stderr.read())
        cls.base='http://127.0.0.1:'+line.split('=')[1]
    @classmethod
    def tearDownClass(cls):
        cls.process.terminate();cls.process.wait(timeout=10);cls.process.stdout.close();cls.process.stderr.close();cls.llm.shutdown();cls.llm.server_close();cls.tmp.cleanup()
    def request(self,path,body=None,method=None):
        req=urllib.request.Request(self.base+path,data=json.dumps(body).encode() if body is not None else None,method=method,headers={'Content-Type':'application/json'})
        with urllib.request.urlopen(req,timeout=30) as response:return json.load(response)
    def path(self,suffix):
        from urllib.parse import quote
        return '/api/meetings/'+quote(self.meeting.name)+suffix
    def test_01_browser_assets(self):
        with urllib.request.urlopen(self.base) as r:
            html=r.read(); self.assertIn(b'assets/',html); self.assertNotIn(b'data-nav="workbench"',html)
    def test_02_glossary_guards(self):
        good=[{'name':'袁夕华','aliases':['夕华'],'errors':['西华'],'enabled':True}]
        self.assertEqual(self.request('/api/glossary',good,'PUT'),good)
        with self.assertRaises(urllib.error.HTTPError):self.request('/api/glossary',[{**good[0],'errors':['夕华']}],'PUT')
    def test_03_tasks_and_original(self):
        tasks=[{'text':'核对','owner':'西华','due':'2026-11-06','done':True}]
        self.request(self.path('/workbench'),{'tasks':tasks,'confirmed':True},'PUT')
        self.request(self.path('/correct'),{'original':'西华','replacement':'夕华'},'POST')
        state=self.request(self.path('/workbench'))
        self.assertTrue(state['tasks'][0]['done']);self.assertEqual(state['tasks'][0]['due'],'2026-11-06')
        self.assertEqual(state['tasks'][0]['owner'],'夕华')
        self.assertEqual(self.request(self.path('/original')),self.transcript)
        self.assertIn('夕华',(self.meeting/'转写.md').read_text())
        self.assertIn('夕华',(self.meeting/'纪要.md').read_text())
    def test_04_grounded_question_and_history(self):
        answer=self.request('/api/workbench/ask',{'scope':'all','question':'谁负责？'},'POST')
        self.assertEqual(answer['sentences_reviewed'],1)
        self.assertEqual(len(answer['parts'][0]['citations']),1)
        self.assertEqual(answer['parts'][0]['citations'][0]['meeting'],self.meeting.name)
        self.assertTrue(self.request('/api/workbench/ask'))
    def test_05_insights_preserve_tasks(self):
        self.request(self.path('/insights'),{},'POST')
        state=self.request(self.path('/workbench'))
        self.assertIn('insights',state);self.assertTrue(state['tasks'][0]['done'])
    def test_055_inbox_resumes_without_retranscribing(self):
        import time
        inbox=self.root/'inbox';inbox.mkdir()
        source=inbox/'synthetic.wav';source.write_bytes(b'synthetic-placeholder')
        stat=source.stat();signature=f'{stat.st_size}:{stat.st_mtime_ns//1000000000}:{stat.st_mtime_ns%1000000000}'
        index={str(source):{'signature':signature,'seen':time.time()-121,'attempts':0,'state':'waiting','meeting':self.meeting.name}}
        (self.root/'inbox-state.json').write_text(json.dumps(index))
        before=(self.meeting/'transcript.json').read_bytes()
        self.request('/api/workbench/inbox',{'enabled':True,'directories':[str(inbox)]},'PUT')
        deadline=time.time()+35
        try:
            while time.time()<deadline:
                state=json.loads((self.root/'inbox-state.json').read_text())[str(source)]
                if state['state'] in ('done','error'):break
                time.sleep(.2)
            self.assertEqual(state['state'],'done',state)
            self.assertEqual(before,(self.meeting/'transcript.json').read_bytes())
            self.assertTrue(source.exists())
            self.assertTrue(self.request(self.path('/workbench'))['tasks'][0]['done'])
        finally:self.request('/api/workbench/inbox',{'enabled':False,'directories':[str(inbox)]},'PUT')

    def test_06_invalid_state_rejected(self):
        with self.assertRaises(urllib.error.HTTPError):self.request(self.path('/workbench'),{'tasks':'bad'},'PUT')
        with self.assertRaises(urllib.error.HTTPError):self.request('/api/workbench/inbox',{'enabled':True,'directories':['relative']},'PUT')
        with self.assertRaises(urllib.error.HTTPError):self.request('/api/workbench/ask',{'scope':'../outside','question':'test'},'POST')

    def test_065_codex_configuration_and_glossary_separation(self):
        config=self.request('/api/config')
        config.update({'api':'codex','model':'','base_url':''})
        self.request('/api/config',config,'PUT')
        self.assertEqual(self.request('/api/config')['api'],'codex')
        self.assertNotIn('袁夕华',self.request('/api/config')['hotwords'])

    def test_066_mlx_catalog_and_directories(self):
        catalog=self.request('/api/models')
        models={m['id']:m for m in catalog['models']}
        self.assertIn('qwen-mlx',models)
        self.assertIn('qwen-mlx-1.7b',models)
        self.assertNotIn('paraformer',models)
        self.assertFalse(models['qwen-mlx']['ready'])
        self.assertEqual(catalog['directory'],str(self.root/'models'))
        self.assertEqual(self.request('/api/env')['llm_model'],'Codex CLI')

    def test_001_empty_inbox_defaults(self):
        self.assertEqual(self.request('/api/workbench/inbox'),{'enabled':False,'directories':[]})

    def test_067_claude_cli_configuration(self):
        config=self.request('/api/config')
        config.update({'api':'claude-cli','model':'','base_url':''})
        self.request('/api/config',config,'PUT')
        self.assertEqual(self.request('/api/config')['api'],'claude-cli')
        self.assertEqual(self.request('/api/env')['llm_model'],'Claude Code CLI')
        req=urllib.request.Request(self.base+'/api/config/test',data=json.dumps({'api':'claude-cli','model':'','base_url':''}).encode(),headers={'Content-Type':'application/json','X-Tingo-Lang':'en'})
        with urllib.request.urlopen(req) as response:
            message=json.load(response)['message']
        self.assertIn('Claude Code CLI',message)
        self.assertTrue(message.isascii())

    def test_07_reader_rejects_all_mutations(self):
        env={**os.environ,'TINGO_ROOT':str(self.root),'TINGO_CONFIG':str(self.root/'config.toml')}
        process=subprocess.Popen([str(ROOT/'app/engine/target/debug/examples/serve'),str(self.root/'models'),'/usr/bin/false','0'],env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
        try:
            base='http://127.0.0.1:'+process.stdout.readline().strip().split('=')[1]
            with urllib.request.urlopen(base+'/api/env') as response:self.assertTrue(json.load(response)['read_only'])
            with urllib.request.urlopen(base+self.path('')) as response:self.assertNotIn('path',json.load(response))
            for path,method in [('/api/config','GET'),('/api/record/start','POST'),('/api/import','POST'),('/api/glossary','PUT'),('/api/workbench/ask','POST'),(self.path(''),'DELETE'),(self.path('/workbench'),'PUT'),(self.path('/correct'),'POST')]:
                with self.assertRaises(urllib.error.HTTPError) as failure:
                    urllib.request.urlopen(urllib.request.Request(base+path,method=method,data=b'{}' if method!='GET' else None,headers={'Content-Type':'application/json'}))
                self.assertIn(failure.exception.code,(404,405))
        finally:
            process.terminate();process.wait(timeout=10);process.stdout.close();process.stderr.close()

if __name__=='__main__':unittest.main(verbosity=2)
