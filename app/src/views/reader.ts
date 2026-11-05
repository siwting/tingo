/** Browser-only record viewer. All mutations remain in the desktop app. */
import {
  api,
  meetingPath,
  url,
  type MeetingSummary,
  type MeetingDetail,
} from "../api";
import { $, main, esc, errorMessage } from "../dom";
import { renderMarkdown } from "../markdown";
import { turnResolver } from "../fishbone";
let generation = 0;
export async function renderReader(id?: string, at = 0): Promise<void> {
  const ticket = ++generation;
  main().innerHTML =
    '<div class="page reader"><h1>会议记录</h1><p id="readerStatus">加载中…</p><div id="readerBody"></div></div>';
  try {
    if (!id) {
      const meetings = await api<MeetingSummary[]>("/api/meetings");
      if (ticket !== generation) return;
      $("#readerStatus").textContent = `${meetings.length} 场会议 · 只读查看`;
      $("#readerBody").innerHTML =
        '<label class="search">搜索会议原文 <input id="readerSearch" class="input" placeholder="标题、项目或原文关键词"></label><div id="readerList"></div>';
      const list = (items: MeetingSummary[]) => {
        $("#readerList").innerHTML =
          items
            .map(
              (m) =>
                `<article class="reader-card"><a href="#/m/${encodeURIComponent(m.id)}"><h2>${esc(m.title)}</h2></a><p>${esc(m.date)} ${esc(m.time)} · ${esc((m.tags ?? []).join(" / "))}</p><p>${esc(m.summary)}</p></article>`,
            )
            .join("") || "<p>没有符合条件的会议</p>";
      };
      list(meetings);
      let seq = 0;
      let timer: number | undefined;
      $<HTMLInputElement>("#readerSearch").oninput = () => {
        clearTimeout(timer);
        const q = $<HTMLInputElement>("#readerSearch").value.trim();
        const n = ++seq;
        if (!q) {
          list(meetings);
          return;
        }
        timer = window.setTimeout(async () => {
          try {
            const found = await api<{
              results: {
                id: string;
                title: string;
                hits: { ms: number; text: string }[];
              }[];
            }>(`/api/search?q=${encodeURIComponent(q)}`);
            if (ticket !== generation || n !== seq) return;
            const matchedIds = new Set(found.results.map((m) => m.id));
            const query = q.toLocaleLowerCase();
            const titles = meetings.filter((m) => !matchedIds.has(m.id) &&
              [m.title, m.summary, ...(m.tags ?? [])].some((value) => value?.toLocaleLowerCase().includes(query)));
            const results = [...titles.map((m) => ({ ...m, hits: [] })), ...found.results];
            $("#readerList").innerHTML =
              results
                .map(
                  (m) =>
                    `<article class="reader-card"><a href="#/m/${encodeURIComponent(m.id)}"><h2>${esc(m.title)}</h2></a>${m.hits.map((h) => `<p><a href="#/m/${encodeURIComponent(m.id)}?t=${h.ms}">${esc(h.text)}</a></p>`).join("")}</article>`,
                )
                .join("") || "<p>未找到相关原文</p>";
          } catch (e) {
            if (ticket === generation)
              $("#readerStatus").textContent = errorMessage(e);
          }
        }, 250);
      };
      return;
    }
    const [d, w] = await Promise.all([
      api<MeetingDetail>(meetingPath(id)),
      api<{
        confirmed?: boolean;
        tasks?: { text: string; owner: string; due: string; done: boolean }[];
        insights?: { parts: { answer: string }[] };
      }>(meetingPath(id, "/workbench")),
    ]);
    if (ticket !== generation) return;
    $("#readerStatus").textContent =
      `${d.date} ${d.time}${w.confirmed ? " · 已人工确认" : ""}`;
    $("#readerBody").innerHTML =
      `<a href="#/meetings">← 会议记录</a><h2>${esc(d.title)}</h2>${d.audio ? `<audio id="readerAudio" controls preload="metadata" src="${esc(url(meetingPath(id, "/audio")))}"></audio>` : ""}<section class="md">${renderMarkdown(d.minutes, { skipHead: true, resolve: turnResolver(d.turns, Infinity) })}</section>${w.tasks?.length ? `<h2>待办</h2>${w.tasks.map((t) => `<p>${t.done ? "☑" : "☐"} ${[t.text, t.owner, t.due].filter(Boolean).map(esc).join(" · ")}</p>`).join("")}` : ""}${w.insights ? `<h2>AI 洞察与建议</h2>${w.insights.parts.map((p) => `<p style="white-space:pre-wrap">${esc(p.answer)}</p>`).join("")}` : ""}<h2>会议原文</h2>${d.turns.map((t) => `<article class="reader-card"><button class="ts" data-ms="${t.start_ms}">${esc(t.ts)}</button> <strong>${esc(t.speaker)}</strong><p>${esc(t.text)}</p></article>`).join("")}`;
    // Export/edit controls emitted by the shared fishbone renderer do not belong in the reader.
    main()
      .querySelectorAll(".fb-draw")
      .forEach((el) => el.remove());
    const audio = document.querySelector<HTMLAudioElement>("#readerAudio");
    if (audio) {
      audio.addEventListener(
        "loadedmetadata",
        () => {
          audio.currentTime = at / 1000;
        },
        { once: true },
      );
      main()
        .querySelectorAll<HTMLElement>("[data-ms]")
        .forEach(
          (el) =>
            (el.onclick = () => {
              audio.currentTime = Number(el.dataset.ms) / 1000;
              void audio.play();
            }),
        );
    }
    main()
      .querySelectorAll<HTMLElement>('.fb-branch[role="button"]')
      .forEach((el) => (el.onclick = () => el.classList.toggle("open")));
  } catch (e) {
    if (ticket === generation) $("#readerStatus").textContent = errorMessage(e);
  }
}
