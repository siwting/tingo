/** Separate legacy embedded analysis for display; keep the original minutes intact. */
export function splitMinutesAnalysis(source: string): { minutes: string; analysis: string } {
  const minutes: string[] = [], analysis: string[] = [];
  let section = 0;
  let fence = "";
  for (const line of source.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
    } else if (!fence) {
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) {
        if (section && heading[1].length <= section) section = 0;
        if (/^(?:AI\s*分析与建议|AI\s+analysis\s+and\s+(?:suggestions|recommendations))(?:\s*[（(].*[）)])?$/i.test(heading[2])) {
          section = heading[1].length;
          continue;
        }
      }
    }
    (section ? analysis : minutes).push(line);
  }
  return { minutes: minutes.join("\n").trim(), analysis: analysis.join("\n").trim() };
}

/** Older imports used category/title lines instead of Markdown headings. */
export function analysisMarkdown(source: string): string {
  let fence = "";
  return source.split("\n").map((line) => {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
    }
    if (!fence && /^(全局诊断|关键洞察|未来推演|决策建议|值得追问)\s*·/.test(line)) return `\n## ${line}\n`;
    return line;
  }).join("\n");
}

/** Hide the duplicated task section in the minutes reading pane only. */
export function minutesWithoutTasks(source: string): string {
  const lines: string[] = [];
  let level = 0, fence = "";
  for (const line of source.split("\n")) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = "";
    } else if (!fence) {
      const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
      if (heading) {
        if (level && heading[1].length <= level) level = 0;
        if (/^(?:待办(?:事项)?|代办(?:事项)?|Tasks|Action items|To-?dos)$/i.test(heading[2])) {
          level = heading[1].length;
          continue;
        }
      }
    }
    if (!level) lines.push(line);
  }
  return lines.join("\n").trim();
}
