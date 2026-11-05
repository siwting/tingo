/** Shared controls mounted inside existing meetings and settings pages. */
import { api, meetingPath } from "../api";
import { esc } from "../dom";
import { t } from "../i18n";
type Answer = {
  parts: {
    answer: string;
    citations: { meeting: string; start_ms: number; quote: string }[];
  }[];
  sentences_reviewed: number;
};
type Task = { text: string; owner: string; due: string; done: boolean };
type Term = {
  name: string;
  aliases: string[];
  errors: string[];
  enabled: boolean;
};
const input = (id: string, label: string) =>
  `<label class="field">${label}<input class="input" id="${id}"></label>`;
const button = (id: string, label: string) =>
  `<button class="btn" id="${id}">${label}</button>`;
function controls(root: HTMLElement) {
  const el = <T extends HTMLElement = HTMLElement>(id: string) =>
    root.querySelector<T>(`#${id}`)!;
  const value = (id: string) => el<HTMLInputElement>(id).value;
  const action = (id: string, run: () => Promise<void>) => {
    el<HTMLButtonElement>(id).onclick = async () => {
      const b = el<HTMLButtonElement>(id);
      b.disabled = true;
      el("wbStatus").textContent = t("处理中…", "Working…");
      try {
        await run();
        if (root.isConnected) el("wbStatus").textContent = t("已完成", "Done");
      } catch (e) {
        if (root.isConnected) el("wbStatus").textContent = String(e);
      } finally {
        b.disabled = false;
      }
    };
  };
  return { el, value, action };
}
const status = '<p class="hint" id="wbStatus" role="status"></p>';
function answers(a: Answer): string {
  return a.parts
    .map(
      (p) =>
        `<p style="white-space:pre-wrap">${esc(p.answer)}</p>${p.citations.map((c) => `<p><a href="#/m/${encodeURIComponent(c.meeting)}?t=${c.start_ms}">${esc(c.quote)}</a></p>`).join("")}`,
    )
    .join("<hr>");
}
export async function mountQuestions(
  root: HTMLElement,
  scope = "all",
): Promise<void> {
  root.classList.add("workbench");
  root.innerHTML = `<h3>${t("会议问答", "Ask meetings")}</h3><p class="hint">${t("回答附原文引用，请结合录音核对。", "Answers include transcript citations. Check them against the recording.")}</p><textarea class="textarea" id="question" maxlength="4000" rows="3" aria-label="${t("问题", "Question")}" placeholder="${t("输入问题", "Ask a question")}"></textarea>${button("ask", t("提问", "Ask"))}${button("history", t("问答历史", "History"))}${status}<div id="answer"></div>`;
  const { el, value, action } = controls(root);
  action("ask", async () => {
    const a = await api<Answer>("/api/workbench/ask", {
      json: { scope, question: value("question") },
    });
    el("answer").innerHTML = answers(a);
  });
  action("history", async () => {
    const rows =
      await api<(Answer & { scope: string; question: string })[]>(
        "/api/workbench/ask",
      );
    el("answer").innerHTML =
      rows
        .filter((r) => r.scope === scope)
        .reverse()
        .map(
          (r) =>
            `<details><summary>${esc(r.question)}</summary>${answers(r)}</details>`,
        )
        .join("") || t("暂无问答历史", "No questions yet");
  });
}
export async function mountMeetingTools(
  root: HTMLElement,
  id: string,
): Promise<void> {
  root.classList.add("workbench");
  root.innerHTML = status;
  try {
    const data = await api<{
      tasks?: Task[];
      confirmed?: boolean;
      insights?: Answer;
    }>(meetingPath(id, "/workbench"));
    if (!root.isConnected) return;
    root.innerHTML = `<h3>${t("待办与确认", "Tasks and review")}</h3><label><input type="checkbox" id="confirmed" ${data.confirmed ? "checked" : ""}> ${t("纪要已人工确认", "Minutes reviewed")}</label><div id="tasks"></div>${button("addTask", t("添加待办", "Add task"))}${button("saveTasks", t("保存", "Save"))}${button("extract", t("从纪要提取待办", "Extract tasks"))}<h3>${t("洞察与建议", "Insights and suggestions")}</h3><div id="insightsText">${data.insights ? answers(data.insights) : ""}</div>${button("insights", t("生成洞察", "Generate insights"))}${button("classify", t("生成标题与分类", "Generate title and tags"))}<details><summary>${t("纠正转写", "Correct transcript")}</summary><p class="hint">${t("保留最初转写，同步更新纪要和待办中的文字。", "Keeps the original transcript and updates matching text in minutes and tasks.")}</p>${input("original", t("错误写法", "Incorrect text"))}${input("replacement", t("正确写法", "Replacement"))}${button("correct", t("纠正", "Correct"))}${button("originalView", t("查看最初原文", "View original transcript"))}<div id="originalText"></div></details>${status}<div id="meetingQuestions"></div>`;
    const { el, value, action } = controls(root);
    let tasks = data.tasks ?? [];
    const draw = () => {
      el("tasks").innerHTML = tasks
        .map(
          (x, i) =>
            `<div class="task-row" data-task="${i}"><input type="checkbox" data-field="done" aria-label="${t("完成", "Done")}" ${x.done ? "checked" : ""}><input class="input" data-field="text" aria-label="${t("待办", "Task")}" value="${esc(x.text)}"><input class="input" data-field="owner" aria-label="${t("负责人", "Owner")}" placeholder="${t("负责人", "Owner")}" value="${esc(x.owner)}"><input class="input" type="date" data-field="due" aria-label="${t("截止日期", "Due date")}" value="${esc(x.due)}"></div>`,
        )
        .join("");
    };
    const collect = () => {
      tasks = Array.from(el("tasks").querySelectorAll("[data-task]")).map(
        (row) => {
          const f = (key: string) =>
            row.querySelector<HTMLInputElement>(`[data-field="${key}"]`)!;
          return {
            text: f("text").value,
            owner: f("owner").value,
            due: f("due").value,
            done: f("done").checked,
          };
        },
      );
    };
    const save = async () => {
      collect();
      await api(meetingPath(id, "/workbench"), {
        method: "PUT",
        json: { tasks, confirmed: el<HTMLInputElement>("confirmed").checked },
      });
    };
    draw();
    el("addTask").onclick = () => {
      collect();
      tasks.push({ text: "", owner: "", due: "", done: false });
      draw();
    };
    action("saveTasks", save);
    action("extract", async () => {
      await save();
      const r = await api<{ tasks: Task[] }>(
        meetingPath(id, "/tasks/extract"),
        { method: "POST" },
      );
      tasks = r.tasks;
      draw();
    });
    action("insights", async () => {
      const r = await api<{ insights: Answer }>(meetingPath(id, "/insights"), {
        method: "POST",
      });
      el("insightsText").innerHTML = answers(r.insights);
    });
    action("classify", async () => {
      await api(meetingPath(id, "/classify"), { method: "POST" });
      location.hash = `#/m/${encodeURIComponent(id)}`;
      location.reload();
    });
    action("correct", async () => {
      await save();
      await api(meetingPath(id, "/correct"), {
        json: {
          original: value("original"),
          replacement: value("replacement"),
        },
      });
      const r = await api<{ tasks: Task[] }>(meetingPath(id, "/workbench"));
      tasks = r.tasks ?? [];
      draw();
    });
    action("originalView", async () => {
      const r = await api<{ sentences: { text: string }[] }>(
        meetingPath(id, "/original"),
      );
      el("originalText").innerHTML =
        `<pre style="white-space:pre-wrap">${esc(r.sentences.map((s) => s.text).join("\n"))}</pre>`;
    });
    await mountQuestions(el("meetingQuestions"), id);
  } catch (e) {
    root.textContent = String(e);
  }
}
export async function mountGlossary(root: HTMLElement): Promise<void> {
  root.classList.add("workbench");
  root.innerHTML = status;
  try {
    let terms = await api<Term[]>("/api/glossary");
    if (!root.isConnected) return;
    root.innerHTML = `<h3>${t("名词与纠错", "Names and corrections")}</h3><p class="hint">${t("正式名称、真实称呼作为识别热词。错误写法单独记录，不将真实称呼误当错字。", "Names and aliases are recognition hotwords. Misheard forms are kept separately from genuine aliases.")}</p><div id="terms"></div>${input("name", t("正式名称", "Name"))}${input("aliases", t("真实称呼（逗号分隔）", "Aliases (comma separated)"))}${input("errors", t("错误写法（逗号分隔）", "Misheard forms (comma separated)"))}${button("saveTerm", t("保存词条", "Save term"))}${status}`;
    const { el, value, action } = controls(root);
    let editing: number | null = null;
    const persist = async (next: Term[]) => {
      terms = await api<Term[]>("/api/glossary", { method: "PUT", json: next });
      draw();
    };
    const draw = () => {
      el("terms").innerHTML = terms
        .map(
          (x, i) =>
            `<div class="st-row"><label><input data-enable="${i}" type="checkbox" ${x.enabled ? "checked" : ""}> ${esc(x.name)} <small>${esc(x.aliases.join(", "))}</small></label><span><button class="btn" data-edit="${i}">${t("编辑", "Edit")}</button><button class="btn" data-remove="${i}">${t("移除", "Remove")}</button></span></div>`,
        )
        .join("");
      el("terms")
        .querySelectorAll<HTMLButtonElement>("[data-edit]")
        .forEach(
          (b) =>
            (b.onclick = () => {
              editing = Number(b.dataset.edit);
              const x = terms[editing];
              el<HTMLInputElement>("name").value = x.name;
              el<HTMLInputElement>("aliases").value = x.aliases.join(", ");
              el<HTMLInputElement>("errors").value = x.errors.join(", ");
            }),
        );
      el("terms")
        .querySelectorAll<HTMLButtonElement>("[data-remove]")
        .forEach(
          (b) =>
            (b.onclick = async () => {
              try {
                await persist(
                  terms.filter((_, i) => i !== Number(b.dataset.remove)),
                );
                editing = null;
              } catch (e) {
                el("wbStatus").textContent = String(e);
              }
            }),
        );
      el("terms")
        .querySelectorAll<HTMLInputElement>("[data-enable]")
        .forEach(
          (b) =>
            (b.onchange = async () => {
              const next = structuredClone(terms);
              next[Number(b.dataset.enable)].enabled = b.checked;
              try {
                await persist(next);
              } catch (e) {
                el("wbStatus").textContent = String(e);
                draw();
              }
            }),
        );
    };
    draw();
    action("saveTerm", async () => {
      const split = (id: string) =>
        value(id)
          .split(/[,，、]/)
          .map((s) => s.trim())
          .filter(Boolean);
      const term = {
        name: value("name").trim(),
        aliases: split("aliases"),
        errors: split("errors"),
        enabled: editing === null ? true : terms[editing].enabled,
      };
      const next = [...terms];
      if (editing === null) next.push(term);
      else next[editing] = term;
      await persist(next);
      editing = null;
      ["name", "aliases", "errors"].forEach(
        (id) => (el<HTMLInputElement>(id).value = ""),
      );
    });
  } catch (e) {
    root.textContent = String(e);
  }
}
export async function mountInbox(root: HTMLElement): Promise<void> {
  root.classList.add("workbench");
  root.innerHTML = status;
  try {
    const inbox = await api<{ enabled: boolean; directories: string[] }>(
      "/api/workbench/inbox",
    );
    if (!root.isConnected) return;
    root.innerHTML = `<h2>${t("自动导入", "Automatic import")}</h2><p class="hint">${t("监视本机目录，文件稳定两分钟后自动导入。保留源文件；失败每五分钟重试，最多三次。", "Watch local folders and import files after two stable minutes. Originals are retained. Failures retry every five minutes, up to three attempts.")}</p><label><input type="checkbox" id="enabled" ${inbox.enabled ? "checked" : ""}> ${t("启用", "Enabled")}</label><label class="field">${t("监视目录（每行一个绝对路径）", "Watched folders (one absolute path per line)")}<textarea class="textarea" rows="4" id="directories">${esc(inbox.directories.join("\n"))}</textarea></label>${button("saveInbox", t("保存", "Save"))}${status}`;
    const { el, value, action } = controls(root);
    action("saveInbox", async () => {
      await api("/api/workbench/inbox", {
        method: "PUT",
        json: {
          enabled: el<HTMLInputElement>("enabled").checked,
          directories: value("directories")
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
        },
      });
    });
  } catch (e) {
    root.textContent = String(e);
  }
}
