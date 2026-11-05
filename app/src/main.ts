import "./style.css";
import { api, type Config, initApi, type Job } from "./api";
import { applyLang, renderShell, t } from "./i18n";
import { checkUpdate } from "./update";
import { shouldOnboard } from "./views/welcome";
import { $, setupModal } from "./dom";
import { poll } from "./poll";
import { route } from "./router";
import { refreshEnv, refreshMeetings } from "./sidebar";
import { S } from "./state";
import { setupPlayerKeys } from "./views/detail";
import { setupImport } from "./views/home";

async function boot(): Promise<void> {
  try {
    await initApi();
  } catch (e) {
    $("#main").innerHTML = `<div class="page"><div class="empty"><h3>${t("本地服务没有启动", "The local service didn't start")}</h3><div>${String(e)}</div></div></div>`;
    return;
  }
  await refreshEnv();
  if (S.env?.read_only) {
    document.body.classList.add("reader-mode");
    document.querySelectorAll<HTMLElement>('.nav a:not([data-nav="meetings"])').forEach(el=>el.remove());
    const logo=document.querySelector<HTMLAnchorElement>('.logo');if(logo)logo.href="#/meetings";
    $("#envBox").textContent="会议记录 · 只读";
    renderShell();setupModal();
    await refreshMeetings();
    window.addEventListener("hashchange",route);route();return;
  }
  if (!S.env?.workbench) document.querySelector('[data-nav="workbench"]')?.remove();
  // 界面语言存在配置里；启动时先用上次记住的语言渲染，拿到配置后不一致再改
  try {
    applyLang(((await api<Config>("/api/config")).ui_language ?? "auto") as "auto");
  } catch {
    /* 拿不到配置就按系统语言 */
  }
  renderShell();
  setupModal();
  setupImport();
  setupPlayerKeys();
  window.addEventListener("hashchange", route);
  await Promise.all([refreshEnv(), refreshMeetings()]);
  try {
    S.job = await api<Job>("/api/job");
  } catch {
    /* 服务刚起来 */
  }
  // 第一次打开：先走新手引导
  if (shouldOnboard() && (!location.hash || location.hash === "#/")) location.hash = "#/welcome";
  route();
  poll();
  // 有新版本时侧栏版本号旁边亮起提示
  checkUpdate().then((u) => {
    if (u?.newer) refreshEnv();
  });
}

boot();
