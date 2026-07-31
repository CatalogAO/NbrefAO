export interface Theme {
  name: string;
  worldColor: string;
  buildColor: string;
}

export const THEMES: Theme[] = [
  { name: "default", worldColor: "#4dabf7", buildColor: "#ff5fa2" },
  { name: "neon", worldColor: "#39ff14", buildColor: "#ff00ff" },
  { name: "mono", worldColor: "#aaaaaa", buildColor: "#eeeeee" },
];

export function findTheme(name: string): Theme | undefined {
  return THEMES.find((t) => t.name.toLowerCase() === name.toLowerCase());
}
