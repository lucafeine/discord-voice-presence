/**
 * Petite couche de journalisation, sans dependance.
 *
 * Toutes les sorties vont sur stderr pour que `stdout` reste exploitable
 * (redirection vers un fichier, pipe vers un autre outil...).
 */

const useColor = process.stderr.isTTY === true && process.env["NO_COLOR"] === undefined;

const paint = (code: string) => (text: string) => (useColor ? `\u001b[${code}m${text}\u001b[0m` : text);

const dim = paint("2");
const bold = paint("1");
const red = paint("31");
const green = paint("32");
const yellow = paint("33");
const blue = paint("36");

function stamp(): string {
  const now = new Date();
  const hh = String(now.getHours()).padStart(2, "0");
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");
  return dim(`${hh}:${mm}:${ss}`);
}

export const log = {
  step(message: string): void {
    process.stderr.write(`${blue(">")} ${bold(message)}\n`);
  },
  info(message: string): void {
    process.stderr.write(`${stamp()} ${message}\n`);
  },
  ok(message: string): void {
    process.stderr.write(`${stamp()} ${green("v")} ${message}\n`);
  },
  warn(message: string): void {
    process.stderr.write(`${stamp()} ${yellow("!")} ${message}\n`);
  },
  error(message: string): void {
    process.stderr.write(`${stamp()} ${red("x")} ${message}\n`);
  },
};
