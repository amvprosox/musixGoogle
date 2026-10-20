const root = document.documentElement;
const boot = window.musix?.boot ?? null;
const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
root.dataset.theme = boot ? boot.theme : prefersDark ? 'dark' : 'light';
