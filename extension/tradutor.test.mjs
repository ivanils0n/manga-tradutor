import assert from "node:assert/strict";
import { interpretar, paraTela } from "./tradutor.js";

const r = interpretar('ok ```{"baloes":[{"caixa":[500,100,100,300],"texto":" Oi "},{"caixa":[1,2,3],"texto":"x"},{"caixa":[0,0,0,10],"texto":"y"},{"caixa":[0,0,2000,10],"texto":"z"}]}```');
assert.deepEqual(r, [
  { l: 0.1, t: 0.1, r: 0.5, b: 0.3, texto: "Oi" },
  { l: 0, t: 0, r: 1, b: 0.01, texto: "z" },
]);
assert.deepEqual(interpretar("sem json"), []);
assert.deepEqual(interpretar("{quebrado}"), []);
assert.deepEqual(
  paraTela([{ l: 0, t: 0.5, r: 1, b: 1, texto: "a" }], { x: 0.25, y: 0.5, w: 0.5, h: 0.25 }),
  [{ l: 0.25, t: 0.625, r: 0.75, b: 0.75, texto: "a" }],
);
console.log("ok");
