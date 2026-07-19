// バイナリアセット（MIDI / SF2 など）を Uint8Array で取得する。

/** URL からバイナリを取得して Uint8Array で返す。 */
export async function loadBinary(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`loadBinary failed: ${res.status} ${res.statusText} (${url})`);
  }
  const buf = await res.arrayBuffer();
  return new Uint8Array(buf);
}
