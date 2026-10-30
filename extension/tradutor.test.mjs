import assert from "node:assert/strict";
import { interpretar } from "./tradutor.js";

const r = interpretar('ok ```{"baloes":[{"caixa":[500,100,100,300],"texto":" Oi "},{"caixa":[1,2,3],"texto":"x"},{"caixa":[0,0,0,10],"texto":"y"},{"caixa":[0,0,2000,10],"texto":"z"}]}```');
assert.deepEqual(r, [
  { l: 0.1, t: 0.1, r: 0.5, b: 0.3, texto: "Oi" },
  { l: 0, t: 0, r: 1, b: 0.01, texto: "z" },
]);
assert.deepEqual(interpretar("sem json"), []);
assert.deepEqual(interpretar("{quebrado}"), []);
console.log("ok");
