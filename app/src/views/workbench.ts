import { analysisMarkdown } from "../analysis";
import { renderMarkdown } from "../markdown";
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
export async function mountMeetingTools(root: HTMLElement, id: string): Promise<void> {
  root.className = "md meeting-tasks";
  root.innerHTML = `<p class="hint">${t("加载中…", "Loading…")}</p>`;
  try {
    const data = await api<{ tasks?: Task[] }>(meetingPath(id, "/workbench"));
    if (!root.isConnected) return;
    root.innerHTML = `${data.tasks?.length
      ? `<ol class="task-reading-list">${data.tasks.map((task) => `<li><p class="task-reading-text">${esc(task.text)}</p><p class="task-reading-meta">${[
        task.owner ? `${t("负责人", "Owner")}: ${esc(task.owner)}` : "",
        task.due ? `${t("截止时间", "Due")}: ${esc(task.due)}` : "",
        task.done ? t("已完成", "Completed") : "",
      ].filter(Boolean).join(" · ")}</p></li>`).join("")}</ol>`
      : `<p class="hint">${t("暂无待办事项。", "No tasks yet.")}</p>`}`;
  } catch (error) {
    if (root.isConnected) root.textContent = String(error);
  }
}
export async function mountGlossary(root: HTMLElement): Promise<void> {
  root.classList.add("workbench");
  root.innerHTML = status;
  try {
    let terms = await api<Term[]>("/api/glossary");
    if (!root.isConnected) return;
    root.innerHTML = `<h3>${t("名词与纠错", "Names and corrections")}</h3><p class="hint">${t("正式名称、真实称呼作为识别热词。错误写法单独记录，不将真实称呼误当错字。", "Names and aliases are recognition hotwords. Misheard forms are kept separately from genuine aliases.")}</p><h4 id="termCount"></h4><div id="terms"></div>${input("name", t("正式名称", "Name"))}${input("aliases", t("真实称呼（逗号分隔）", "Aliases (comma separated)"))}${input("errors", t("错误写法（逗号分隔）", "Misheard forms (comma separated)"))}${button("saveTerm", t("保存词条", "Save term"))}${status}`;
    const { el, value, action } = controls(root);
    let editing: number | null = null;
    const persist = async (next: Term[]) => {
      terms = await api<Term[]>("/api/glossary", { method: "PUT", json: next });
      draw();
    };
    const draw = () => {
      el("termCount").textContent = t(
        `已保存的词条（${terms.length}）`,
        `Saved terms (${terms.length})`,
      );
      el("terms").innerHTML =
        terms
          .map(
            (x, i) =>
              `<div class="st-row"><label><input data-enable="${i}" type="checkbox" ${x.enabled ? "checked" : ""}> ${esc(x.name)} <small>${esc(x.aliases.join(", "))}${x.errors.length ? ` · ${t("错误写法", "Misheard")}: ${esc(x.errors.join(", "))}` : ""}</small></label><span><button class="btn" data-edit="${i}">${t("编辑", "Edit")}</button><button class="btn" data-remove="${i}">${t("移除", "Remove")}</button></span></div>`,
          )
          .join("") ||
        `<p class="hint">${t("还没有保存的名词词条", "No saved terms yet")}</p>`;
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
    const inbox = await api<{ enabled: boolean; directories: string[]; scan_errors?: {path: string; error: string}[] }>(
      "/api/workbench/inbox",
    );
    if (!root.isConnected) return;
    root.innerHTML = `<h2>${t("自动导入", "Automatic import")}</h2><p class="hint">${t("监视本机目录，文件稳定两分钟后自动导入。保留源文件；失败每五分钟重试，最多三次。", "Watch local folders and import files after two stable minutes. Originals are retained. Failures retry every five minutes, up to three attempts.")}</p><label><input type="checkbox" id="enabled" ${inbox.enabled ? "checked" : ""}> ${t("启用", "Enabled")}</label><label class="field">${t("监视目录（每行一个绝对路径）", "Watched folders (one absolute path per line)")}<textarea class="textarea" rows="4" id="directories">${esc((inbox.directories ?? []).join("\n"))}</textarea></label>${button("saveInbox", t("保存", "Save"))}${(inbox.scan_errors ?? []).map(e => `<p role="alert" class="hint">${esc(t("无法读取监听目录", "Cannot read watched folder"))}: ${esc(e.path)} — ${esc(e.error)}</p>`).join("")}${status}`;
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

export async function mountMeetingAnalysis(root: HTMLElement, id: string, legacy: string): Promise<void> {
  root.className = "meeting-analysis";
  root.innerHTML = status;
  try {
    const data = await api<{ insights?: Answer }>(meetingPath(id, "/workbench"));
    if (!root.isConnected) return;
    root.innerHTML = `<p class="analysis-note">${t("基于会议原文的 AI 推断与建议，不代表会议决定。", "AI interpretations and suggestions based on the transcript, not meeting decisions.")}</p><div id="insightsText"></div>${button("insights", t("重新生成分析", "Generate analysis"))}${status}`;
    const { el, action } = controls(root);
    const show = (answer?: Answer) => {
      el("insightsText").innerHTML = answer?.parts?.length ? answer.parts.map((part) => `<div class="md">${renderMarkdown(analysisMarkdown(part.answer))}</div>${part.citations.map((citation) => `<p class="hint"><a href="#/m/${encodeURIComponent(citation.meeting)}?t=${citation.start_ms}">${esc(citation.quote)}</a></p>`).join("")}`).join("<hr>") : legacy ? `<div class="md">${renderMarkdown(analysisMarkdown(legacy))}</div>` : `<p class="hint">${t("还没有分析与建议。", "No analysis yet.")}</p>`;
    };
    show(data.insights);
    action("insights", async () => {
      const result = await api<{ insights: Answer }>(meetingPath(id, "/insights"), { method: "POST" });
      if (root.isConnected) show(result.insights);
    });
  } catch (error) {
    if (root.isConnected) root.innerHTML = `${legacy ? `<div class="md">${renderMarkdown(analysisMarkdown(legacy))}</div>` : ""}<p role="status">${esc(String(error))}</p>`;
  }
}
