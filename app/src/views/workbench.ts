import { api, meetingPath, type MeetingSummary } from "../api";
import { $, main, esc, errorMessage } from "../dom";
type Term = {
  name: string;
  aliases: string[];
  errors: string[];
  enabled: boolean;
};
type Answer = {
  parts: {
    answer: string;
    citations: { meeting: string; start_ms: number; quote: string }[];
  }[];
  sentences_reviewed: number;
};
export async function renderWorkbench(): Promise<void> {
  main().innerHTML =
    '<div class="page workbench"><h1>会议工作台</h1><p id="wbStatus">加载中…</p><div id="wbBody"></div></div>';
  try {
    const meetings = await api<MeetingSummary[]>("/api/meetings");
    let terms = await api<Term[]>("/api/glossary");
    const options = meetings
      .map((m) => `<option value="${esc(m.id)}">${esc(m.title)}</option>`)
      .join("");
    $("#wbStatus").textContent = "AI 分析需要核对原文；音频在本机处理。";
    $("#wbBody").innerHTML =
      `<h2>问会议</h2><select id="scope"><option value="all">全部会议</option>${options}</select><textarea id="question" rows="3" maxlength="4000" placeholder="输入问题"></textarea><button class="btn" id="ask">提问</button><button class="btn" id="history">问答历史</button><div id="answer"></div><h2>专有名词</h2><div id="terms"></div><input id="name" placeholder="正式名称"><input id="aliases" placeholder="真实称呼，逗号分隔"><input id="errors" placeholder="错误写法，逗号分隔"><button class="btn" id="add">添加</button><h2>本场原文纠正</h2><select id="meeting">${options}</select><input id="original" maxlength="64" placeholder="错误写法"><input id="replacement" maxlength="64" placeholder="正确写法"><button class="btn" id="correct">纠正并保留原始转写</button><button class="btn" id="originalView">最初 ASR 原文</button><div id="originalText"></div>`;

    $("#wbBody").insertAdjacentHTML(
      "beforeend",
      `<h2>待办与纪要确认</h2><button class="btn" id="loadNotes">加载所选会议</button><button class="btn" id="classify">智能标题与分类</button><div id="notes"></div><h2>自动投递</h2><p>文件稳定 120 秒且未被占用后处理；失败每 5 分钟重试，最多 3 次。</p><label><input type="checkbox" id="inboxEnabled">启用</label><textarea id="inboxDirs" rows="3" placeholder="每行一个本机目录的绝对路径"></textarea><button class="btn" id="saveInbox">保存投递设置</button>`,
    );
    const inbox = await api<{ enabled?: boolean; directories?: string[] }>(
      "/api/workbench/inbox",
    );
    $<HTMLInputElement>("#inboxEnabled").checked = !!inbox.enabled;
    $<HTMLTextAreaElement>("#inboxDirs").value = (inbox.directories ?? []).join(
      "\n",
    );
    $("#saveInbox").onclick = async () => {
      try {
        await api("/api/workbench/inbox", {
          method: "PUT",
          json: {
            enabled: $<HTMLInputElement>("#inboxEnabled").checked,
            directories: $<HTMLTextAreaElement>("#inboxDirs")
              .value.split("\n")
              .map((x) => x.trim())
              .filter(Boolean),
          },
        });
        $("#wbStatus").textContent = "投递设置已保存";
      } catch (e) {
        report(e);
      }
    };
    $("#classify").onclick = async () => {
      const id = $<HTMLSelectElement>("#meeting").value;
      if (!id) return;
      const b = $<HTMLButtonElement>("#classify");
      b.disabled = true;
      try {
        const meta = await api<{ title: string; tags: string[] }>(
          meetingPath(id, "/classify"),
          { method: "POST" },
        );
        $("#wbStatus").textContent =
          `已更新：${meta.title} · ${meta.tags.join("、")}`;
      } catch (e) {
        report(e);
      } finally {
        b.disabled = false;
      }
    };
    $("#loadNotes").onclick = async () => {
      const id = $<HTMLSelectElement>("#meeting").value;
      if (!id) return;
      type Task = { text: string; owner: string; due: string; done: boolean };
      try {
        const data = await api<{
          confirmed?: boolean;
          tasks?: Task[];
          insights?: Answer;
        }>(meetingPath(id, "/workbench"));
        let tasks = data.tasks ?? [];
        $("#notes").innerHTML =
          `<p>${esc(meetings.find((m) => m.id === id)?.title ?? id)}</p><label><input type="checkbox" id="confirmed" ${data.confirmed ? "checked" : ""}>已人工确认</label><div id="tasks"></div><button class="btn" id="extractTasks">从纪要提取待办</button><button class="btn" id="addTask">添加待办</button><button class="btn" id="saveNotes">保存</button><h3>AI 洞察</h3><button class="btn" id="insights">生成诊断、洞察与建议</button><div id="insightText"></div>`;
        const showInsights = (a?: Answer) => {
          $("#insightText").innerHTML = (a?.parts ?? [])
            .map((p) => `<p style="white-space:pre-wrap">${esc(p.answer)}</p>`)
            .join("");
        };
        showInsights(data.insights);
        const drawTasks = () => {
          $("#tasks").innerHTML = tasks
            .map(
              (t, i) =>
                `<p data-task="${i}"><input data-field="done" type="checkbox" ${t.done ? "checked" : ""}><input data-field="text" placeholder="待办" value="${esc(t.text)}"><input data-field="owner" placeholder="负责人" value="${esc(t.owner)}"><input data-field="due" type="date" value="${esc(t.due)}"></p>`,
            )
            .join("");
        };
        const collect = () => {
          $("#tasks")
            .querySelectorAll<HTMLElement>("[data-task]")
            .forEach((row) => {
              const value = (f: string) =>
                row.querySelector<HTMLInputElement>(`[data-field="${f}"]`)!;
              tasks[Number(row.dataset.task)] = {
                text: value("text").value,
                owner: value("owner").value,
                due: value("due").value,
                done: value("done").checked,
              };
            });
        };
        drawTasks();
        $("#extractTasks").onclick = async () => {
          const b = $<HTMLButtonElement>("#extractTasks");
          b.disabled = true;
          try {
            const result = await api<{ tasks: Task[] }>(
              meetingPath(id, "/tasks/extract"),
              { method: "POST" },
            );
            tasks = result.tasks;
            drawTasks();
          } catch (e) {
            report(e);
          } finally {
            b.disabled = false;
          }
        };
        $("#addTask").onclick = () => {
          collect();
          tasks.push({ text: "", owner: "", due: "", done: false });
          drawTasks();
        };
        $("#saveNotes").onclick = async () => {
          collect();
          try {
            await api(meetingPath(id, "/workbench"), {
              method: "PUT",
              json: {
                tasks,
                confirmed: $<HTMLInputElement>("#confirmed").checked,
              },
            });
            $("#wbStatus").textContent = "已保存";
          } catch (e) {
            report(e);
          }
        };
        $("#insights").onclick = async () => {
          const b = $<HTMLButtonElement>("#insights");
          b.disabled = true;
          try {
            const result = await api<{ insights: Answer }>(
              meetingPath(id, "/insights"),
              { method: "POST" },
            );
            showInsights(result.insights);
          } catch (e) {
            report(e);
          } finally {
            b.disabled = false;
          }
        };
      } catch (e) {
        report(e);
      }
    };
    const report = (e: unknown) => {
      $("#wbStatus").textContent = errorMessage(e);
    };
    let editing: number | null = null;
    const draw = () => {
      $("#terms").innerHTML = terms
        .map(
          (t, i) =>
            `<p><input type="checkbox" data-enable="${i}" ${t.enabled ? "checked" : ""}>${esc(t.name)} · ${esc(t.aliases.join("、"))}<button class="btn" data-edit="${i}">编辑</button><button class="btn" data-remove="${i}">移除</button></p>`,
        )
        .join("");
      $("#terms")
        .querySelectorAll<HTMLButtonElement>("[data-edit]")
        .forEach(
          (el) =>
            (el.onclick = () => {
              editing = Number(el.dataset.edit);
              const term = terms[editing];
              $<HTMLInputElement>("#name").value = term.name;
              $<HTMLInputElement>("#aliases").value = term.aliases.join("、");
              $<HTMLInputElement>("#errors").value = term.errors.join("、");
              $("#add").textContent = "保存词条";
            }),
        );
      $("#terms")
        .querySelectorAll<HTMLInputElement>("[data-enable]")
        .forEach(
          (el) =>
            (el.onchange = async () => {
              const next = structuredClone(terms);
              next[Number(el.dataset.enable)].enabled = el.checked;
              try {
                terms = await api<Term[]>("/api/glossary", {
                  method: "PUT",
                  json: next,
                });
                draw();
              } catch (e) {
                report(e);
                draw();
              }
            }),
        );
      $("#terms")
        .querySelectorAll<HTMLButtonElement>("[data-remove]")
        .forEach(
          (el) =>
            (el.onclick = async () => {
              try {
                terms = await api<Term[]>("/api/glossary", {
                  method: "PUT",
                  json: terms.filter((_, i) => i !== Number(el.dataset.remove)),
                });
                draw();
              } catch (e) {
                report(e);
              }
            }),
        );
    };
    draw();
    $("#add").onclick = async () => {
      const split = (id: string) =>
        $<HTMLInputElement>(id)
          .value.split(/[,，、]/)
          .map((s) => s.trim())
          .filter(Boolean);
      try {
        terms = await api<Term[]>("/api/glossary", {
          method: "PUT",
          json: [
            ...terms.filter((_, i) => i !== editing),
            {
              name: $<HTMLInputElement>("#name").value.trim(),
              aliases: split("#aliases"),
              errors: split("#errors"),
              enabled: true,
            },
          ],
        });
        editing = null;
        $("#add").textContent = "添加";
        draw();
      } catch (e) {
        report(e);
      }
    };
    $("#correct").onclick = async () => {
      try {
        await api(
          meetingPath($<HTMLSelectElement>("#meeting").value, "/correct"),
          {
            method: "POST",
            json: {
              original: $<HTMLInputElement>("#original").value,
              replacement: $<HTMLInputElement>("#replacement").value,
            },
          },
        );
        $("#wbStatus").textContent = "原文已纠正，最初转写已保留";
      } catch (e) {
        report(e);
      }
    };
    $("#history").onclick = async () => {
      try {
        const records =
          await api<(Answer & { question: string; scope: string })[]>(
            "/api/workbench/ask",
          );
        const scope = $<HTMLSelectElement>("#scope").value;
        $("#answer").innerHTML =
          records
            .filter((r) => r.scope === scope)
            .reverse()
            .map(
              (r) =>
                `<details><summary>${esc(r.question)}</summary>${r.parts.map((p) => `<p style="white-space:pre-wrap">${esc(p.answer)}</p>${p.citations.map((c) => `<p><a href="#/m/${encodeURIComponent(c.meeting)}?t=${c.start_ms}">${esc(c.quote)}</a></p>`).join("")}`).join("")}</details>`,
            )
            .join("") || "暂无问答历史";
      } catch (e) {
        report(e);
      }
    };
    $("#originalView").onclick = async () => {
      try {
        const tr = await api<{ sentences: { text: string }[] }>(
          meetingPath($<HTMLSelectElement>("#meeting").value, "/original"),
        );
        $("#originalText").innerHTML =
          `<pre style="white-space:pre-wrap">${esc(tr.sentences.map((x) => x.text).join("\n"))}</pre>`;
      } catch (e) {
        report(e);
      }
    };
    $("#ask").onclick = async () => {
      const button = $<HTMLButtonElement>("#ask");
      button.disabled = true;
      $("#answer").textContent = "正在检索…";
      try {
        const a = await api<Answer>("/api/workbench/ask", {
          method: "POST",
          json: {
            scope: $<HTMLSelectElement>("#scope").value,
            question: $<HTMLTextAreaElement>("#question").value,
          },
        });
        $("#answer").innerHTML =
          `<p>已检查 ${a.sentences_reviewed} 段原文</p>` +
          a.parts
            .map(
              (p) =>
                `<p style="white-space:pre-wrap">${esc(p.answer)}</p>` +
                p.citations
                  .map(
                    (c) =>
                      `<p><a href="#/m/${encodeURIComponent(c.meeting)}?t=${c.start_ms}">${esc(c.quote)}</a></p>`,
                  )
                  .join(""),
            )
            .join("<hr>");
      } catch (e) {
        $("#answer").textContent = errorMessage(e);
      } finally {
        button.disabled = false;
      }
    };
  } catch (e) {
    $("#wbStatus").textContent = errorMessage(e);
  }
}
