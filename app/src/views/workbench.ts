import { analysisMarkdown } from "../analysis";
import { renderMarkdown } from "../markdown";
/** Shared controls mounted inside existing meetings and settings pages. */
import { api, meetingPath } from "../api";
import { esc, fmt } from "../dom";
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
    type TaskData = { tasks?: Task[]; tasks_error?: string };
    const data = await api<TaskData>(meetingPath(id, "/workbench"));
    if (!root.isConnected) return;
    const show = (value: TaskData) => {
      root.innerHTML = `${value.tasks?.length
        ? `<ol class="task-reading-list">${value.tasks.map((task) => `<li><p class="task-reading-text">${esc(task.text)}</p><p class="task-reading-meta">${[
          task.owner ? `${t("负责人", "Owner")}: ${esc(task.owner)}` : "",
          task.due ? `${t("截止时间", "Due")}: ${esc(task.due)}` : "",
          task.done ? t("已完成", "Completed") : "",
        ].filter(Boolean).join(" · ")}</p></li>`).join("")}</ol>`
        : `<p class="hint">${t("暂无待办事项，可从会议原文提取。", "No tasks yet. Extract them from the transcript.")}</p>`}
        ${value.tasks_error ? `<p role="alert">${esc(value.tasks_error)}</p>` : ""}
        ${button("extractTasks", t("提取待办", "Extract tasks"))}${status}`;
      const { action } = controls(root);
      action("extractTasks", async () => {
        const result = await api<TaskData>(meetingPath(id, "/tasks/extract"), { method: "POST" });
        if (root.isConnected) show(result);
      });
    };
    show(data);
  } catch (error) {
    if (root.isConnected) root.textContent = String(error);
  }
}
/** 名词库：每个词是一个词条。输入框加的词只有正式名称；点词可以补充真实称呼和错误写法。
 *  正式名称、真实称呼给识别模型当热词，也交给大模型写纪要；错误写法只交给大模型纠正。 */
export async function mountGlossary(root: HTMLElement): Promise<void> {
  root.classList.add("workbench");
  root.innerHTML = status;
  try {
    let terms = await api<Term[]>("/api/glossary");
    if (!root.isConnected) return;
    root.innerHTML = `<div class="tags" id="gTags"><input id="gInput" aria-label="${t("添加词", "Add words")}" placeholder="${t("输入后回车添加，可以一次粘贴多个（用逗号或空格隔开）", "Type and press Enter — paste several at once, separated by commas or spaces")}"></div>
      <p class="hint" id="termCount"></p>
      <div class="term-editor" id="gEditor" hidden>
        <h4 id="gEditTitle"></h4>
        ${input("name", t("正式名称", "Name"))}
        ${input("aliases", t("真实称呼（逗号分隔，也会当热词）", "Aliases (comma separated, also used as hotwords)"))}
        ${input("errors", t("错误写法（逗号分隔，只用来纠正纪要）", "Misheard forms (comma separated, only used to correct minutes)"))}
        <label><input type="checkbox" id="gEnabled"> ${t("启用", "Enabled")}</label>
        <div class="term-editor-actions">${button("saveTerm", t("保存词条", "Save term"))}<button class="btn" id="cancelTerm">${t("取消", "Cancel")}</button></div>
      </div>${status}`;
    const { el, value, action } = controls(root);
    const tags = el("gTags");
    const field = el<HTMLInputElement>("gInput");
    let editing: number | null = null;
    const persist = async (next: Term[]) => {
      terms = await api<Term[]>("/api/glossary", { method: "PUT", json: next });
      draw();
    };
    const closeEditor = () => {
      editing = null;
      el("gEditor").hidden = true;
    };
    const openEditor = (i: number) => {
      editing = i;
      const x = terms[i];
      el("gEditTitle").textContent = t(`编辑「${x.name}」`, `Edit “${x.name}”`);
      el<HTMLInputElement>("name").value = x.name;
      el<HTMLInputElement>("aliases").value = x.aliases.join(", ");
      el<HTMLInputElement>("errors").value = x.errors.join(", ");
      el<HTMLInputElement>("gEnabled").checked = x.enabled;
      el("gEditor").hidden = false;
      el<HTMLInputElement>("aliases").focus();
    };
    const draw = () => {
      tags.querySelectorAll(".chip").forEach((c) => c.remove());
      terms.forEach((x, i) => {
        const chip = document.createElement("span");
        chip.className = `chip term-chip${x.enabled ? "" : " off"}`;
        const extra = [
          x.aliases.length ? x.aliases.join("、") : "",
          x.errors.length ? `${t("错", "not")} ${x.errors.join("、")}` : "",
        ].filter(Boolean).join(" · ");
        chip.innerHTML = `<button class="chip-name" title="${t("编辑真实称呼、错误写法", "Edit aliases and misheard forms")}">${esc(x.name)}${extra ? ` <small>${esc(extra)}</small>` : ""}</button><button class="x" title="${t("删除", "Remove")}">×</button>`;
        chip.querySelector<HTMLButtonElement>(".chip-name")!.onclick = () => openEditor(i);
        chip.querySelector<HTMLButtonElement>(".x")!.onclick = async () => {
          try {
            closeEditor();
            await persist(terms.filter((_, j) => j !== i));
          } catch (e) {
            el("wbStatus").textContent = String(e);
          }
        };
        field.before(chip);
      });
      const on = terms.filter((x) => x.enabled);
      const hot = new Set(on.flatMap((x) => [x.name, ...x.aliases])).size;
      el("termCount").textContent = terms.length
        ? t(
            `${terms.length} 个词条，${hot} 个热词在用${terms.length > on.length ? `，${terms.length - on.length} 个已停用` : ""}。点一个词可以补充真实称呼（如「夕华、华华」）和错误写法（如「西华」）。`,
            `${terms.length} terms, ${hot} hotwords in use${terms.length > on.length ? `, ${terms.length - on.length} disabled` : ""}. Click a word to add aliases and misheard forms.`,
          )
        : t("还没有词。人名、项目代号、内部系统名、行业术语都可以加。", "No words yet. Add names, project codes, internal systems, jargon.");
    };
    draw();
    const addPending = async () => {
      const words = field.value.split(/[,，、\s]+/).map((w) => w.trim()).filter(Boolean);
      if (!words.length) return;
      field.value = "";
      try {
        const r = await api<{ terms: Term[]; added: number }>("/api/glossary/words", { method: "POST", json: { words } });
        terms = r.terms;
        draw();
        el("wbStatus").textContent =
          r.added < words.length
            ? t(`已添加 ${r.added} 个，其余已在名词库里或是登记过的错误写法`, `Added ${r.added}; the rest already exist or are recorded misheard forms`)
            : "";
      } catch (e) {
        field.value = words.join(", ");
        el("wbStatus").textContent = String(e);
      }
    };
    field.onkeydown = (e) => {
      if ((e.key === "Enter" || e.key === "," || e.key === "，") && field.value.trim()) {
        e.preventDefault();
        void addPending();
      }
    };
    field.onblur = () => void addPending();
    el("cancelTerm").onclick = closeEditor;
    action("saveTerm", async () => {
      if (editing === null) return;
      const split = (id: string) =>
        value(id)
          .split(/[,，、]/)
          .map((s) => s.trim())
          .filter(Boolean);
      const term = {
        name: value("name").trim(),
        aliases: split("aliases"),
        errors: split("errors"),
        enabled: el<HTMLInputElement>("gEnabled").checked,
      };
      // 别的词如果只是个单独的词（没有称呼和错误写法），现在成了这个词条的称呼，就并进来
      const folded = new Set(term.aliases.map((a) => a.toLowerCase()));
      const next = terms
        .map((x, i) => (i === editing ? term : x))
        .filter(
          (x, i) =>
            i === editing ||
            x.aliases.length ||
            x.errors.length ||
            !folded.has(x.name.toLowerCase()),
        );
      await persist(next);
      closeEditor();
    });
  } catch (e) {
    root.textContent = String(e);
  }
}
export async function mountInbox(root: HTMLElement): Promise<void> {
  root.classList.add("workbench");
  root.innerHTML = status;
  try {
    const inbox = await api<{ enabled: boolean; directories: string[]; scan_errors?: {path: string; error: string; permission_denied?: boolean}[] }>(
      "/api/workbench/inbox",
    );
    if (!root.isConnected) return;
    root.innerHTML = `<h2>${t("自动导入", "Automatic import")}</h2><p class="hint">${t("监视本机目录，文件稳定两分钟后自动导入。保留源文件；失败每五分钟重试，最多三次。", "Watch local folders and import files after two stable minutes. Originals are retained. Failures retry every five minutes, up to three attempts.")}</p><label><input type="checkbox" id="enabled" ${inbox.enabled ? "checked" : ""}> ${t("启用", "Enabled")}</label><label class="field">${t("监视目录（每行一个绝对路径）", "Watched folders (one absolute path per line)")}<textarea class="textarea" rows="4" id="directories">${esc((inbox.directories ?? []).join("\n"))}</textarea></label>${button("saveInbox", t("保存", "Save"))}${(inbox.scan_errors ?? []).map(e => `<p role="alert" class="hint">${esc(t("无法读取监听目录", "Cannot read watched folder"))}: ${esc(e.path)} — ${esc(e.error)}${e.permission_denied ? `<br>${esc(t("被 macOS 隐私保护拦截。请在「系统设置 → 隐私与安全性 → 完全磁盘访问权限」里打开 Tingo，然后彻底退出并重新打开 Tingo。如果开关已经打开仍然报错，说明授权属于旧版本：先点「−」删掉 Tingo，再点「+」重新添加。", "Blocked by macOS privacy protection. Turn on Tingo in System Settings → Privacy & Security → Full Disk Access, then quit and reopen Tingo. If it is already on and this still appears, the permission belongs to an older build: remove Tingo with “−” and add it again with “+”."))}` : ""}</p>`).join("")}${status}`;
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
      el("insightsText").innerHTML = answer?.parts?.length ? answer.parts.map((part) => `<div class="md">${renderMarkdown(analysisMarkdown(part.answer))}</div>${part.citations.length ? `<details class="analysis-evidence"><summary>${t("原文依据", "Transcript evidence")}（${part.citations.length}${t("条", " excerpts")}）</summary><ol>${part.citations.map((citation) => `<li><a href="#/m/${encodeURIComponent(citation.meeting)}?t=${citation.start_ms}"><span class="evidence-time">${fmt(citation.start_ms)}</span> ${esc(citation.quote)}</a></li>`).join("")}</ol></details>` : ""}`).join("<hr>") : legacy ? `<div class="md">${renderMarkdown(analysisMarkdown(legacy))}</div>` : `<p class="hint">${t("还没有分析与建议。", "No analysis yet.")}</p>`;
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
