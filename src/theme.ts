export interface Theme {
  name: string; base: string; border: string; title: string; checkName: string;
  selection: string; meta: string; pass: string; fail: string; pending: string;
  skip: string; flag: string; error: string;
}

const mocha: Theme = {
  name: "mocha", base: "#1e1e2e", border: "#313244", title: "#cba6f7", checkName: "#94e2d5",
  selection: "#89b4fa", meta: "#6c7086", pass: "#a6e3a1", fail: "#f38ba8", pending: "#fab387",
  skip: "#6c7086", flag: "#f9e2af", error: "#f38ba8",
};

const THEMES: Record<string, Theme> = { mocha };

export function getTheme(name: string): Theme {
  return THEMES[name] ?? mocha;
}
