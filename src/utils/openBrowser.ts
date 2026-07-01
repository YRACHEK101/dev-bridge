import { execa } from "execa";

/**
 * Best-effort "open this URL in the default browser". Never throws — if it
 * fails (headless, no browser, CI) we simply don't open anything.
 */
export async function openBrowser(url: string): Promise<void> {
  const { command, args } = openCommand(url);
  try {
    await execa(command, args, { stdio: "ignore", reject: true });
  } catch {
    /* ignore — opening a browser is a convenience, not a requirement */
  }
}

/** The platform-specific command used to open a URL (exported for testing). */
export function openCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  switch (platform) {
    case "darwin":
      return { command: "open", args: [url] };
    case "win32":
      // `start` is a shell builtin; the empty "" is the window title arg.
      return { command: "cmd", args: ["/c", "start", "", url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
}
