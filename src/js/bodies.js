// Extra simulated bodies ("body packs", e.g. src/data/biped.json from sim/build-biped.mjs)
// merged into the upstream dataset at load time, so src/data.json stays untouched.
// A pack holds { key, model, solution, mode?, compare?, compareSub?, lede? }. Pure: no DOM.
export function addBody(data, pack) {
  if (!pack || !pack.key || !pack.model || !pack.solution) throw new Error('body pack needs key, model and solution');
  data.models = data.models || {};
  if (data.models[pack.key]) throw new Error(`body "${pack.key}" is already in the dataset`);
  data.models[pack.key] = pack.model;
  // like the other non-default bodies: a variant, so it is not ranked against the quadruped's gaits
  const label = (pack.mode && pack.mode.label) || pack.model.label || pack.key;
  data.solutions.push({ ...pack.solution, summary: { ...pack.solution.summary, model: pack.key, variant: pack.key, variant_label: label } });
  const sol = data.solutions.length - 1;
  if (data.modes && pack.mode) data.modes.push({ ...pack.mode, kicker: `Mode ${data.modes.length + 1}`, sol });
  if (data.compare && pack.compare) {
    data.compare.cols.push(pack.compare);
    if (pack.compareSub) data.compare.sub = `${data.compare.sub} ${pack.compareSub}`;
  }
  if (pack.lede) data.lede = pack.lede;
  return data;
}
