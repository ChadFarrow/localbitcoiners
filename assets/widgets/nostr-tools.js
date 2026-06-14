var rr = Object.defineProperty;
var or = (t, e, n) => e in t ? rr(t, e, { enumerable: !0, configurable: !0, writable: !0, value: n }) : t[e] = n;
var h = (t, e, n) => or(t, typeof e != "symbol" ? e + "" : e, n);
/*! noble-hashes - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function mt(t) {
  return t instanceof Uint8Array || ArrayBuffer.isView(t) && t.constructor.name === "Uint8Array";
}
function he(t, e = "") {
  if (!Number.isSafeInteger(t) || t < 0) {
    const n = e && `"${e}" `;
    throw new Error(`${n}expected integer >= 0, got ${t}`);
  }
}
function N(t, e, n = "") {
  const r = mt(t), o = t == null ? void 0 : t.length, i = e !== void 0;
  if (!r || i && o !== e) {
    const s = n && `"${n}" `, a = i ? ` of length ${e}` : "", c = r ? `length=${o}` : `type=${typeof t}`;
    throw new Error(s + "expected Uint8Array" + a + ", got " + c);
  }
  return t;
}
function je(t) {
  if (typeof t != "function" || typeof t.create != "function")
    throw new Error("Hash must wrapped by utils.createHasher");
  he(t.outputLen), he(t.blockLen);
}
function qe(t, e = !0) {
  if (t.destroyed)
    throw new Error("Hash instance has been destroyed");
  if (e && t.finished)
    throw new Error("Hash#digest() has already been called");
}
function ir(t, e) {
  N(t, void 0, "digestInto() output");
  const n = e.outputLen;
  if (t.length < n)
    throw new Error('"digestInto() output" expected to be of length >=' + n);
}
function Oe(...t) {
  for (let e = 0; e < t.length; e++)
    t[e].fill(0);
}
function tt(t) {
  return new DataView(t.buffer, t.byteOffset, t.byteLength);
}
function ie(t, e) {
  return t << 32 - e | t >>> e;
}
const en = /* @ts-ignore */ typeof Uint8Array.from([]).toHex == "function" && typeof Uint8Array.fromHex == "function", sr = /* @__PURE__ */ Array.from({ length: 256 }, (t, e) => e.toString(16).padStart(2, "0"));
function q(t) {
  if (N(t), en)
    return t.toHex();
  let e = "";
  for (let n = 0; n < t.length; n++)
    e += sr[t[n]];
  return e;
}
const se = { _0: 48, _9: 57, A: 65, F: 70, a: 97, f: 102 };
function Nt(t) {
  if (t >= se._0 && t <= se._9)
    return t - se._0;
  if (t >= se.A && t <= se.F)
    return t - (se.A - 10);
  if (t >= se.a && t <= se.f)
    return t - (se.a - 10);
}
function P(t) {
  if (typeof t != "string")
    throw new Error("hex string expected, got " + typeof t);
  if (en)
    return Uint8Array.fromHex(t);
  const e = t.length, n = e / 2;
  if (e % 2)
    throw new Error("hex string expected, got unpadded hex of length " + e);
  const r = new Uint8Array(n);
  for (let o = 0, i = 0; o < n; o++, i += 2) {
    const s = Nt(t.charCodeAt(i)), a = Nt(t.charCodeAt(i + 1));
    if (s === void 0 || a === void 0) {
      const c = t[i] + t[i + 1];
      throw new Error('hex string expected, got non-hex character "' + c + '" at index ' + i);
    }
    r[o] = s * 16 + a;
  }
  return r;
}
function ee(...t) {
  let e = 0;
  for (let r = 0; r < t.length; r++) {
    const o = t[r];
    N(o), e += o.length;
  }
  const n = new Uint8Array(e);
  for (let r = 0, o = 0; r < t.length; r++) {
    const i = t[r];
    n.set(i, o), o += i.length;
  }
  return n;
}
function cr(t, e = {}) {
  const n = (o, i) => t(i).update(o).digest(), r = t(void 0);
  return n.outputLen = r.outputLen, n.blockLen = r.blockLen, n.create = (o) => t(o), Object.assign(n, e), Object.freeze(n);
}
function _e(t = 32) {
  const e = typeof globalThis == "object" ? globalThis.crypto : null;
  if (typeof (e == null ? void 0 : e.getRandomValues) != "function")
    throw new Error("crypto.getRandomValues must be defined");
  return e.getRandomValues(new Uint8Array(t));
}
const ar = (t) => ({
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, t])
});
function ur(t, e, n) {
  return t & e ^ ~t & n;
}
function fr(t, e, n) {
  return t & e ^ t & n ^ e & n;
}
class lr {
  constructor(e, n, r, o) {
    h(this, "blockLen");
    h(this, "outputLen");
    h(this, "padOffset");
    h(this, "isLE");
    // For partial updates less than block size
    h(this, "buffer");
    h(this, "view");
    h(this, "finished", !1);
    h(this, "length", 0);
    h(this, "pos", 0);
    h(this, "destroyed", !1);
    this.blockLen = e, this.outputLen = n, this.padOffset = r, this.isLE = o, this.buffer = new Uint8Array(e), this.view = tt(this.buffer);
  }
  update(e) {
    qe(this), N(e);
    const { view: n, buffer: r, blockLen: o } = this, i = e.length;
    for (let s = 0; s < i; ) {
      const a = Math.min(o - this.pos, i - s);
      if (a === o) {
        const c = tt(e);
        for (; o <= i - s; s += o)
          this.process(c, s);
        continue;
      }
      r.set(e.subarray(s, s + a), this.pos), this.pos += a, s += a, this.pos === o && (this.process(n, 0), this.pos = 0);
    }
    return this.length += e.length, this.roundClean(), this;
  }
  digestInto(e) {
    qe(this), ir(e, this), this.finished = !0;
    const { buffer: n, view: r, blockLen: o, isLE: i } = this;
    let { pos: s } = this;
    n[s++] = 128, Oe(this.buffer.subarray(s)), this.padOffset > o - s && (this.process(r, 0), s = 0);
    for (let f = s; f < o; f++)
      n[f] = 0;
    r.setBigUint64(o - 8, BigInt(this.length * 8), i), this.process(r, 0);
    const a = tt(e), c = this.outputLen;
    if (c % 4)
      throw new Error("_sha2: outputLen must be aligned to 32bit");
    const u = c / 4, g = this.get();
    if (u > g.length)
      throw new Error("_sha2: outputLen bigger than state");
    for (let f = 0; f < u; f++)
      a.setUint32(4 * f, g[f], i);
  }
  digest() {
    const { buffer: e, outputLen: n } = this;
    this.digestInto(e);
    const r = e.slice(0, n);
    return this.destroy(), r;
  }
  _cloneInto(e) {
    e || (e = new this.constructor()), e.set(...this.get());
    const { blockLen: n, buffer: r, length: o, finished: i, destroyed: s, pos: a } = this;
    return e.destroyed = s, e.finished = i, e.length = o, e.pos = a, o % n && e.buffer.set(r), e;
  }
  clone() {
    return this._cloneInto();
  }
}
const ue = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]), dr = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]), fe = /* @__PURE__ */ new Uint32Array(64);
class hr extends lr {
  constructor(e) {
    super(64, e, 8, !1);
  }
  get() {
    const { A: e, B: n, C: r, D: o, E: i, F: s, G: a, H: c } = this;
    return [e, n, r, o, i, s, a, c];
  }
  // prettier-ignore
  set(e, n, r, o, i, s, a, c) {
    this.A = e | 0, this.B = n | 0, this.C = r | 0, this.D = o | 0, this.E = i | 0, this.F = s | 0, this.G = a | 0, this.H = c | 0;
  }
  process(e, n) {
    for (let f = 0; f < 16; f++, n += 4)
      fe[f] = e.getUint32(n, !1);
    for (let f = 16; f < 64; f++) {
      const w = fe[f - 15], y = fe[f - 2], b = ie(w, 7) ^ ie(w, 18) ^ w >>> 3, x = ie(y, 17) ^ ie(y, 19) ^ y >>> 10;
      fe[f] = x + fe[f - 7] + b + fe[f - 16] | 0;
    }
    let { A: r, B: o, C: i, D: s, E: a, F: c, G: u, H: g } = this;
    for (let f = 0; f < 64; f++) {
      const w = ie(a, 6) ^ ie(a, 11) ^ ie(a, 25), y = g + w + ur(a, c, u) + dr[f] + fe[f] | 0, x = (ie(r, 2) ^ ie(r, 13) ^ ie(r, 22)) + fr(r, o, i) | 0;
      g = u, u = c, c = a, a = s + y | 0, s = i, i = o, o = r, r = y + x | 0;
    }
    r = r + this.A | 0, o = o + this.B | 0, i = i + this.C | 0, s = s + this.D | 0, a = a + this.E | 0, c = c + this.F | 0, u = u + this.G | 0, g = g + this.H | 0, this.set(r, o, i, s, a, c, u, g);
  }
  roundClean() {
    Oe(fe);
  }
  destroy() {
    this.set(0, 0, 0, 0, 0, 0, 0, 0), Oe(this.buffer);
  }
}
class gr extends hr {
  constructor() {
    super(32);
    // We cannot use array here since array allows indexing by variable
    // which means optimizer/compiler cannot use registers.
    h(this, "A", ue[0] | 0);
    h(this, "B", ue[1] | 0);
    h(this, "C", ue[2] | 0);
    h(this, "D", ue[3] | 0);
    h(this, "E", ue[4] | 0);
    h(this, "F", ue[5] | 0);
    h(this, "G", ue[6] | 0);
    h(this, "H", ue[7] | 0);
  }
}
const ae = /* @__PURE__ */ cr(
  () => new gr(),
  /* @__PURE__ */ ar(1)
);
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const vt = /* @__PURE__ */ BigInt(0), lt = /* @__PURE__ */ BigInt(1);
function Pe(t, e = "") {
  if (typeof t != "boolean") {
    const n = e && `"${e}" `;
    throw new Error(n + "expected boolean, got type=" + typeof t);
  }
  return t;
}
function tn(t) {
  if (typeof t == "bigint") {
    if (!Ne(t))
      throw new Error("positive bigint expected, got " + t);
  } else
    he(t);
  return t;
}
function Ie(t) {
  const e = tn(t).toString(16);
  return e.length & 1 ? "0" + e : e;
}
function nn(t) {
  if (typeof t != "string")
    throw new Error("hex string expected, got " + typeof t);
  return t === "" ? vt : BigInt("0x" + t);
}
function Te(t) {
  return nn(q(t));
}
function rn(t) {
  return nn(q(yr(N(t)).reverse()));
}
function xt(t, e) {
  he(e), t = tn(t);
  const n = P(t.toString(16).padStart(e * 2, "0"));
  if (n.length !== e)
    throw new Error("number too large");
  return n;
}
function on(t, e) {
  return xt(t, e).reverse();
}
function yr(t) {
  return Uint8Array.from(t);
}
function wr(t) {
  return Uint8Array.from(t, (e, n) => {
    const r = e.charCodeAt(0);
    if (e.length !== 1 || r > 127)
      throw new Error(`string contains non-ASCII character "${t[n]}" with code ${r} at position ${n}`);
    return r;
  });
}
const Ne = (t) => typeof t == "bigint" && vt <= t;
function br(t, e, n) {
  return Ne(t) && Ne(e) && Ne(n) && e <= t && t < n;
}
function pr(t, e, n, r) {
  if (!br(e, n, r))
    throw new Error("expected valid " + t + ": " + n + " <= n < " + r + ", got " + e);
}
function Er(t) {
  let e;
  for (e = 0; t > vt; t >>= lt, e += 1)
    ;
  return e;
}
const St = (t) => (lt << BigInt(t)) - lt;
function mr(t, e, n) {
  if (he(t, "hashLen"), he(e, "qByteLen"), typeof n != "function")
    throw new Error("hmacFn must be a function");
  const r = (A) => new Uint8Array(A), o = Uint8Array.of(), i = Uint8Array.of(0), s = Uint8Array.of(1), a = 1e3;
  let c = r(t), u = r(t), g = 0;
  const f = () => {
    c.fill(1), u.fill(0), g = 0;
  }, w = (...A) => n(u, ee(c, ...A)), y = (A = o) => {
    u = w(i, A), c = w(), A.length !== 0 && (u = w(s, A), c = w());
  }, b = () => {
    if (g++ >= a)
      throw new Error("drbg: tried max amount of iterations");
    let A = 0;
    const O = [];
    for (; A < e; ) {
      c = w();
      const $ = c.slice();
      O.push($), A += c.length;
    }
    return ee(...O);
  };
  return (A, O) => {
    f(), y(A);
    let $;
    for (; !($ = O(b())); )
      y();
    return f(), $;
  };
}
function Bt(t, e = {}, n = {}) {
  if (!t || typeof t != "object")
    throw new Error("expected valid options object");
  function r(i, s, a) {
    const c = t[i];
    if (a && c === void 0)
      return;
    const u = typeof c;
    if (u !== s || c === null)
      throw new Error(`param "${i}" is invalid: expected ${s}, got ${u}`);
  }
  const o = (i, s) => Object.entries(i).forEach(([a, c]) => r(a, c, s));
  o(e, !1), o(n, !0);
}
function Ut(t) {
  const e = /* @__PURE__ */ new WeakMap();
  return (n, ...r) => {
    const o = e.get(n);
    if (o !== void 0)
      return o;
    const i = t(n, ...r);
    return e.set(n, i), i;
  };
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const te = /* @__PURE__ */ BigInt(0), J = /* @__PURE__ */ BigInt(1), ye = /* @__PURE__ */ BigInt(2), sn = /* @__PURE__ */ BigInt(3), cn = /* @__PURE__ */ BigInt(4), an = /* @__PURE__ */ BigInt(5), vr = /* @__PURE__ */ BigInt(7), un = /* @__PURE__ */ BigInt(8), xr = /* @__PURE__ */ BigInt(9), fn = /* @__PURE__ */ BigInt(16);
function oe(t, e) {
  const n = t % e;
  return n >= te ? n : e + n;
}
function re(t, e, n) {
  let r = t;
  for (; e-- > te; )
    r *= r, r %= n;
  return r;
}
function Ct(t, e) {
  if (t === te)
    throw new Error("invert: expected non-zero number");
  if (e <= te)
    throw new Error("invert: expected positive modulus, got " + e);
  let n = oe(t, e), r = e, o = te, i = J;
  for (; n !== te; ) {
    const a = r / n, c = r % n, u = o - i * a;
    r = n, n = c, o = i, i = u;
  }
  if (r !== J)
    throw new Error("invert: does not exist");
  return oe(o, e);
}
function At(t, e, n) {
  if (!t.eql(t.sqr(e), n))
    throw new Error("Cannot find square root");
}
function ln(t, e) {
  const n = (t.ORDER + J) / cn, r = t.pow(e, n);
  return At(t, r, e), r;
}
function Sr(t, e) {
  const n = (t.ORDER - an) / un, r = t.mul(e, ye), o = t.pow(r, n), i = t.mul(e, o), s = t.mul(t.mul(i, ye), o), a = t.mul(i, t.sub(s, t.ONE));
  return At(t, a, e), a;
}
function Br(t) {
  const e = Fe(t), n = dn(t), r = n(e, e.neg(e.ONE)), o = n(e, r), i = n(e, e.neg(r)), s = (t + vr) / fn;
  return (a, c) => {
    let u = a.pow(c, s), g = a.mul(u, r);
    const f = a.mul(u, o), w = a.mul(u, i), y = a.eql(a.sqr(g), c), b = a.eql(a.sqr(f), c);
    u = a.cmov(u, g, y), g = a.cmov(w, f, b);
    const x = a.eql(a.sqr(g), c), A = a.cmov(u, g, x);
    return At(a, A, c), A;
  };
}
function dn(t) {
  if (t < sn)
    throw new Error("sqrt is not defined for small field");
  let e = t - J, n = 0;
  for (; e % ye === te; )
    e /= ye, n++;
  let r = ye;
  const o = Fe(t);
  for (; qt(o, r) === 1; )
    if (r++ > 1e3)
      throw new Error("Cannot find square root: probably non-prime P");
  if (n === 1)
    return ln;
  let i = o.pow(r, e);
  const s = (e + J) / ye;
  return function(c, u) {
    if (c.is0(u))
      return u;
    if (qt(c, u) !== 1)
      throw new Error("Cannot find square root");
    let g = n, f = c.mul(c.ONE, i), w = c.pow(u, e), y = c.pow(u, s);
    for (; !c.eql(w, c.ONE); ) {
      if (c.is0(w))
        return c.ZERO;
      let b = 1, x = c.sqr(w);
      for (; !c.eql(x, c.ONE); )
        if (b++, x = c.sqr(x), b === g)
          throw new Error("Cannot find square root");
      const A = J << BigInt(g - b - 1), O = c.pow(f, A);
      g = b, f = c.sqr(O), w = c.mul(w, f), y = c.mul(y, O);
    }
    return y;
  };
}
function Ar(t) {
  return t % cn === sn ? ln : t % un === an ? Sr : t % fn === xr ? Br(t) : dn(t);
}
const Rr = [
  "create",
  "isValid",
  "is0",
  "neg",
  "inv",
  "sqrt",
  "sqr",
  "eql",
  "add",
  "sub",
  "mul",
  "pow",
  "div",
  "addN",
  "subN",
  "mulN",
  "sqrN"
];
function Or(t) {
  const e = {
    ORDER: "bigint",
    BYTES: "number",
    BITS: "number"
  }, n = Rr.reduce((r, o) => (r[o] = "function", r), e);
  return Bt(t, n), t;
}
function _r(t, e, n) {
  if (n < te)
    throw new Error("invalid exponent, negatives unsupported");
  if (n === te)
    return t.ONE;
  if (n === J)
    return e;
  let r = t.ONE, o = e;
  for (; n > te; )
    n & J && (r = t.mul(r, o)), o = t.sqr(o), n >>= J;
  return r;
}
function hn(t, e, n = !1) {
  const r = new Array(e.length).fill(n ? t.ZERO : void 0), o = e.reduce((s, a, c) => t.is0(a) ? s : (r[c] = s, t.mul(s, a)), t.ONE), i = t.inv(o);
  return e.reduceRight((s, a, c) => t.is0(a) ? s : (r[c] = t.mul(s, r[c]), t.mul(s, a)), i), r;
}
function qt(t, e) {
  const n = (t.ORDER - J) / ye, r = t.pow(e, n), o = t.eql(r, t.ONE), i = t.eql(r, t.ZERO), s = t.eql(r, t.neg(t.ONE));
  if (!o && !i && !s)
    throw new Error("invalid Legendre symbol result");
  return o ? 1 : i ? 0 : -1;
}
function Tr(t, e) {
  e !== void 0 && he(e);
  const n = e !== void 0 ? e : t.toString(2).length, r = Math.ceil(n / 8);
  return { nBitLength: n, nByteLength: r };
}
class kr {
  constructor(e, n = {}) {
    h(this, "ORDER");
    h(this, "BITS");
    h(this, "BYTES");
    h(this, "isLE");
    h(this, "ZERO", te);
    h(this, "ONE", J);
    h(this, "_lengths");
    h(this, "_sqrt");
    // cached sqrt
    h(this, "_mod");
    var s;
    if (e <= te)
      throw new Error("invalid field: expected ORDER > 0, got " + e);
    let r;
    this.isLE = !1, n != null && typeof n == "object" && (typeof n.BITS == "number" && (r = n.BITS), typeof n.sqrt == "function" && (this.sqrt = n.sqrt), typeof n.isLE == "boolean" && (this.isLE = n.isLE), n.allowedLengths && (this._lengths = (s = n.allowedLengths) == null ? void 0 : s.slice()), typeof n.modFromBytes == "boolean" && (this._mod = n.modFromBytes));
    const { nBitLength: o, nByteLength: i } = Tr(e, r);
    if (i > 2048)
      throw new Error("invalid field: expected ORDER of <= 2048 bytes");
    this.ORDER = e, this.BITS = o, this.BYTES = i, this._sqrt = void 0, Object.preventExtensions(this);
  }
  create(e) {
    return oe(e, this.ORDER);
  }
  isValid(e) {
    if (typeof e != "bigint")
      throw new Error("invalid field element: expected bigint, got " + typeof e);
    return te <= e && e < this.ORDER;
  }
  is0(e) {
    return e === te;
  }
  // is valid and invertible
  isValidNot0(e) {
    return !this.is0(e) && this.isValid(e);
  }
  isOdd(e) {
    return (e & J) === J;
  }
  neg(e) {
    return oe(-e, this.ORDER);
  }
  eql(e, n) {
    return e === n;
  }
  sqr(e) {
    return oe(e * e, this.ORDER);
  }
  add(e, n) {
    return oe(e + n, this.ORDER);
  }
  sub(e, n) {
    return oe(e - n, this.ORDER);
  }
  mul(e, n) {
    return oe(e * n, this.ORDER);
  }
  pow(e, n) {
    return _r(this, e, n);
  }
  div(e, n) {
    return oe(e * Ct(n, this.ORDER), this.ORDER);
  }
  // Same as above, but doesn't normalize
  sqrN(e) {
    return e * e;
  }
  addN(e, n) {
    return e + n;
  }
  subN(e, n) {
    return e - n;
  }
  mulN(e, n) {
    return e * n;
  }
  inv(e) {
    return Ct(e, this.ORDER);
  }
  sqrt(e) {
    return this._sqrt || (this._sqrt = Ar(this.ORDER)), this._sqrt(this, e);
  }
  toBytes(e) {
    return this.isLE ? on(e, this.BYTES) : xt(e, this.BYTES);
  }
  fromBytes(e, n = !1) {
    N(e);
    const { _lengths: r, BYTES: o, isLE: i, ORDER: s, _mod: a } = this;
    if (r) {
      if (!r.includes(e.length) || e.length > o)
        throw new Error("Field.fromBytes: expected " + r + " bytes, got " + e.length);
      const u = new Uint8Array(o);
      u.set(e, i ? 0 : u.length - e.length), e = u;
    }
    if (e.length !== o)
      throw new Error("Field.fromBytes: expected " + o + " bytes, got " + e.length);
    let c = i ? rn(e) : Te(e);
    if (a && (c = oe(c, s)), !n && !this.isValid(c))
      throw new Error("invalid field element: outside of range 0..ORDER");
    return c;
  }
  // TODO: we don't need it here, move out to separate fn
  invertBatch(e) {
    return hn(this, e);
  }
  // We can't move this out because Fp6, Fp12 implement it
  // and it's unclear what to return in there.
  cmov(e, n, r) {
    return r ? n : e;
  }
}
function Fe(t, e = {}) {
  return new kr(t, e);
}
function gn(t) {
  if (typeof t != "bigint")
    throw new Error("field order must be bigint");
  const e = t.toString(2).length;
  return Math.ceil(e / 8);
}
function yn(t) {
  const e = gn(t);
  return e + Math.ceil(e / 2);
}
function wn(t, e, n = !1) {
  N(t);
  const r = t.length, o = gn(e), i = yn(e);
  if (r < 16 || r < i || r > 1024)
    throw new Error("expected " + i + "-1024 bytes of input, got " + r);
  const s = n ? rn(t) : Te(t), a = oe(s, e - J) + J;
  return n ? on(a, o) : xt(a, o);
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const xe = /* @__PURE__ */ BigInt(0), we = /* @__PURE__ */ BigInt(1);
function De(t, e) {
  const n = e.negate();
  return t ? n : e;
}
function Pt(t, e) {
  const n = hn(t.Fp, e.map((r) => r.Z));
  return e.map((r, o) => t.fromAffine(r.toAffine(n[o])));
}
function bn(t, e) {
  if (!Number.isSafeInteger(t) || t <= 0 || t > e)
    throw new Error("invalid window size, expected [1.." + e + "], got W=" + t);
}
function nt(t, e) {
  bn(t, e);
  const n = Math.ceil(e / t) + 1, r = 2 ** (t - 1), o = 2 ** t, i = St(t), s = BigInt(t);
  return { windows: n, windowSize: r, mask: i, maxNumber: o, shiftBy: s };
}
function Dt(t, e, n) {
  const { windowSize: r, mask: o, maxNumber: i, shiftBy: s } = n;
  let a = Number(t & o), c = t >> s;
  a > r && (a -= i, c += we);
  const u = e * r, g = u + Math.abs(a) - 1, f = a === 0, w = a < 0, y = e % 2 !== 0;
  return { nextN: c, offset: g, isZero: f, isNeg: w, isNegF: y, offsetF: u };
}
const rt = /* @__PURE__ */ new WeakMap(), pn = /* @__PURE__ */ new WeakMap();
function ot(t) {
  return pn.get(t) || 1;
}
function Vt(t) {
  if (t !== xe)
    throw new Error("invalid wNAF");
}
class Ir {
  // Parametrized with a given Point class (not individual point)
  constructor(e, n) {
    h(this, "BASE");
    h(this, "ZERO");
    h(this, "Fn");
    h(this, "bits");
    this.BASE = e.BASE, this.ZERO = e.ZERO, this.Fn = e.Fn, this.bits = n;
  }
  // non-const time multiplication ladder
  _unsafeLadder(e, n, r = this.ZERO) {
    let o = e;
    for (; n > xe; )
      n & we && (r = r.add(o)), o = o.double(), n >>= we;
    return r;
  }
  /**
   * Creates a wNAF precomputation window. Used for caching.
   * Default window size is set by `utils.precompute()` and is equal to 8.
   * Number of precomputed points depends on the curve size:
   * 2^(𝑊−1) * (Math.ceil(𝑛 / 𝑊) + 1), where:
   * - 𝑊 is the window size
   * - 𝑛 is the bitlength of the curve order.
   * For a 256-bit curve and window size 8, the number of precomputed points is 128 * 33 = 4224.
   * @param point Point instance
   * @param W window size
   * @returns precomputed point tables flattened to a single array
   */
  precomputeWindow(e, n) {
    const { windows: r, windowSize: o } = nt(n, this.bits), i = [];
    let s = e, a = s;
    for (let c = 0; c < r; c++) {
      a = s, i.push(a);
      for (let u = 1; u < o; u++)
        a = a.add(s), i.push(a);
      s = a.double();
    }
    return i;
  }
  /**
   * Implements ec multiplication using precomputed tables and w-ary non-adjacent form.
   * More compact implementation:
   * https://github.com/paulmillr/noble-secp256k1/blob/47cb1669b6e506ad66b35fe7d76132ae97465da2/index.ts#L502-L541
   * @returns real and fake (for const-time) points
   */
  wNAF(e, n, r) {
    if (!this.Fn.isValid(r))
      throw new Error("invalid scalar");
    let o = this.ZERO, i = this.BASE;
    const s = nt(e, this.bits);
    for (let a = 0; a < s.windows; a++) {
      const { nextN: c, offset: u, isZero: g, isNeg: f, isNegF: w, offsetF: y } = Dt(r, a, s);
      r = c, g ? i = i.add(De(w, n[y])) : o = o.add(De(f, n[u]));
    }
    return Vt(r), { p: o, f: i };
  }
  /**
   * Implements ec unsafe (non const-time) multiplication using precomputed tables and w-ary non-adjacent form.
   * @param acc accumulator point to add result of multiplication
   * @returns point
   */
  wNAFUnsafe(e, n, r, o = this.ZERO) {
    const i = nt(e, this.bits);
    for (let s = 0; s < i.windows && r !== xe; s++) {
      const { nextN: a, offset: c, isZero: u, isNeg: g } = Dt(r, s, i);
      if (r = a, !u) {
        const f = n[c];
        o = o.add(g ? f.negate() : f);
      }
    }
    return Vt(r), o;
  }
  getPrecomputes(e, n, r) {
    let o = rt.get(n);
    return o || (o = this.precomputeWindow(n, e), e !== 1 && (typeof r == "function" && (o = r(o)), rt.set(n, o))), o;
  }
  cached(e, n, r) {
    const o = ot(e);
    return this.wNAF(o, this.getPrecomputes(o, e, r), n);
  }
  unsafe(e, n, r, o) {
    const i = ot(e);
    return i === 1 ? this._unsafeLadder(e, n, o) : this.wNAFUnsafe(i, this.getPrecomputes(i, e, r), n, o);
  }
  // We calculate precomputes for elliptic curve point multiplication
  // using windowed method. This specifies window size and
  // stores precomputed values. Usually only base point would be precomputed.
  createCache(e, n) {
    bn(n, this.bits), pn.set(e, n), rt.delete(e);
  }
  hasCache(e) {
    return ot(e) !== 1;
  }
}
function Lr(t, e, n, r) {
  let o = e, i = t.ZERO, s = t.ZERO;
  for (; n > xe || r > xe; )
    n & we && (i = i.add(o)), r & we && (s = s.add(o)), o = o.double(), n >>= we, r >>= we;
  return { p1: i, p2: s };
}
function Mt(t, e, n) {
  if (e) {
    if (e.ORDER !== t)
      throw new Error("Field.ORDER must match order: Fp == p, Fn == n");
    return Or(e), e;
  } else
    return Fe(t, { isLE: n });
}
function $r(t, e, n = {}, r) {
  if (r === void 0 && (r = t === "edwards"), !e || typeof e != "object")
    throw new Error(`expected valid ${t} CURVE object`);
  for (const c of ["p", "n", "h"]) {
    const u = e[c];
    if (!(typeof u == "bigint" && u > xe))
      throw new Error(`CURVE.${c} must be positive bigint`);
  }
  const o = Mt(e.p, n.Fp, r), i = Mt(e.n, n.Fn, r), a = ["Gx", "Gy", "a", "b"];
  for (const c of a)
    if (!o.isValid(e[c]))
      throw new Error(`CURVE.${c} must be valid field element of CURVE.Fp`);
  return e = Object.freeze(Object.assign({}, e)), { CURVE: e, Fp: o, Fn: i };
}
function En(t, e) {
  return function(r) {
    const o = t(r);
    return { secretKey: o, publicKey: e(o) };
  };
}
class mn {
  constructor(e, n) {
    h(this, "oHash");
    h(this, "iHash");
    h(this, "blockLen");
    h(this, "outputLen");
    h(this, "finished", !1);
    h(this, "destroyed", !1);
    if (je(e), N(n, void 0, "key"), this.iHash = e.create(), typeof this.iHash.update != "function")
      throw new Error("Expected instance of class which extends utils.Hash");
    this.blockLen = this.iHash.blockLen, this.outputLen = this.iHash.outputLen;
    const r = this.blockLen, o = new Uint8Array(r);
    o.set(n.length > r ? e.create().update(n).digest() : n);
    for (let i = 0; i < o.length; i++)
      o[i] ^= 54;
    this.iHash.update(o), this.oHash = e.create();
    for (let i = 0; i < o.length; i++)
      o[i] ^= 106;
    this.oHash.update(o), Oe(o);
  }
  update(e) {
    return qe(this), this.iHash.update(e), this;
  }
  digestInto(e) {
    qe(this), N(e, this.outputLen, "output"), this.finished = !0, this.iHash.digestInto(e), this.oHash.update(e), this.oHash.digestInto(e), this.destroy();
  }
  digest() {
    const e = new Uint8Array(this.oHash.outputLen);
    return this.digestInto(e), e;
  }
  _cloneInto(e) {
    e || (e = Object.create(Object.getPrototypeOf(this), {}));
    const { oHash: n, iHash: r, finished: o, destroyed: i, blockLen: s, outputLen: a } = this;
    return e = e, e.finished = o, e.destroyed = i, e.blockLen = s, e.outputLen = a, e.oHash = n._cloneInto(e.oHash), e.iHash = r._cloneInto(e.iHash), e;
  }
  clone() {
    return this._cloneInto();
  }
  destroy() {
    this.destroyed = !0, this.oHash.destroy(), this.iHash.destroy();
  }
}
const ke = (t, e, n) => new mn(t, e).update(n).digest();
ke.create = (t, e) => new mn(t, e);
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const zt = (t, e) => (t + (t >= 0 ? e : -e) / vn) / e;
function Hr(t, e, n) {
  const [[r, o], [i, s]] = e, a = zt(s * t, n), c = zt(-o * t, n);
  let u = t - a * r - c * i, g = -a * o - c * s;
  const f = u < ce, w = g < ce;
  f && (u = -u), w && (g = -g);
  const y = St(Math.ceil(Er(n) / 2)) + ve;
  if (u < ce || u >= y || g < ce || g >= y)
    throw new Error("splitScalar (endomorphism): failed, k=" + t);
  return { k1neg: f, k1: u, k2neg: w, k2: g };
}
function dt(t) {
  if (!["compact", "recovered", "der"].includes(t))
    throw new Error('Signature format must be "compact", "recovered", or "der"');
  return t;
}
function it(t, e) {
  const n = {};
  for (let r of Object.keys(e))
    n[r] = t[r] === void 0 ? e[r] : t[r];
  return Pe(n.lowS, "lowS"), Pe(n.prehash, "prehash"), n.format !== void 0 && dt(n.format), n;
}
class Nr extends Error {
  constructor(e = "") {
    super(e);
  }
}
const le = {
  // asn.1 DER encoding utils
  Err: Nr,
  // Basic building block is TLV (Tag-Length-Value)
  _tlv: {
    encode: (t, e) => {
      const { Err: n } = le;
      if (t < 0 || t > 256)
        throw new n("tlv.encode: wrong tag");
      if (e.length & 1)
        throw new n("tlv.encode: unpadded data");
      const r = e.length / 2, o = Ie(r);
      if (o.length / 2 & 128)
        throw new n("tlv.encode: long form length too big");
      const i = r > 127 ? Ie(o.length / 2 | 128) : "";
      return Ie(t) + i + o + e;
    },
    // v - value, l - left bytes (unparsed)
    decode(t, e) {
      const { Err: n } = le;
      let r = 0;
      if (t < 0 || t > 256)
        throw new n("tlv.encode: wrong tag");
      if (e.length < 2 || e[r++] !== t)
        throw new n("tlv.decode: wrong tlv");
      const o = e[r++], i = !!(o & 128);
      let s = 0;
      if (!i)
        s = o;
      else {
        const c = o & 127;
        if (!c)
          throw new n("tlv.decode(long): indefinite length not supported");
        if (c > 4)
          throw new n("tlv.decode(long): byte length is too big");
        const u = e.subarray(r, r + c);
        if (u.length !== c)
          throw new n("tlv.decode: length bytes not complete");
        if (u[0] === 0)
          throw new n("tlv.decode(long): zero leftmost byte");
        for (const g of u)
          s = s << 8 | g;
        if (r += c, s < 128)
          throw new n("tlv.decode(long): not minimal encoding");
      }
      const a = e.subarray(r, r + s);
      if (a.length !== s)
        throw new n("tlv.decode: wrong value length");
      return { v: a, l: e.subarray(r + s) };
    }
  },
  // https://crypto.stackexchange.com/a/57734 Leftmost bit of first byte is 'negative' flag,
  // since we always use positive integers here. It must always be empty:
  // - add zero byte if exists
  // - if next byte doesn't have a flag, leading zero is not allowed (minimal encoding)
  _int: {
    encode(t) {
      const { Err: e } = le;
      if (t < ce)
        throw new e("integer: negative integers are not allowed");
      let n = Ie(t);
      if (Number.parseInt(n[0], 16) & 8 && (n = "00" + n), n.length & 1)
        throw new e("unexpected DER parsing assertion: unpadded hex");
      return n;
    },
    decode(t) {
      const { Err: e } = le;
      if (t[0] & 128)
        throw new e("invalid signature integer: negative");
      if (t[0] === 0 && !(t[1] & 128))
        throw new e("invalid signature integer: unnecessary leading zero");
      return Te(t);
    }
  },
  toSig(t) {
    const { Err: e, _int: n, _tlv: r } = le, o = N(t, void 0, "signature"), { v: i, l: s } = r.decode(48, o);
    if (s.length)
      throw new e("invalid signature: left bytes after parsing");
    const { v: a, l: c } = r.decode(2, i), { v: u, l: g } = r.decode(2, c);
    if (g.length)
      throw new e("invalid signature: left bytes after parsing");
    return { r: n.decode(a), s: n.decode(u) };
  },
  hexFromSig(t) {
    const { _tlv: e, _int: n } = le, r = e.encode(2, n.encode(t.r)), o = e.encode(2, n.encode(t.s)), i = r + o;
    return e.encode(48, i);
  }
}, ce = BigInt(0), ve = BigInt(1), vn = BigInt(2), Le = BigInt(3), Ur = BigInt(4);
function Cr(t, e = {}) {
  const n = $r("weierstrass", t, e), { Fp: r, Fn: o } = n;
  let i = n.CURVE;
  const { h: s, n: a } = i;
  Bt(e, {}, {
    allowInfinityPoint: "boolean",
    clearCofactor: "function",
    isTorsionFree: "function",
    fromBytes: "function",
    toBytes: "function",
    endo: "object"
  });
  const { endo: c } = e;
  if (c && (!r.is0(i.a) || typeof c.beta != "bigint" || !Array.isArray(c.basises)))
    throw new Error('invalid endo: expected "beta": bigint and "basises": array');
  const u = Sn(r, o);
  function g() {
    if (!r.isOdd)
      throw new Error("compression is not supported: Field does not have .isOdd()");
  }
  function f(_, d, l) {
    const { x: p, y: m } = d.toAffine(), B = r.toBytes(p);
    if (Pe(l, "isCompressed"), l) {
      g();
      const v = !r.isOdd(m);
      return ee(xn(v), B);
    } else
      return ee(Uint8Array.of(4), B, r.toBytes(m));
  }
  function w(_) {
    N(_, void 0, "Point");
    const { publicKey: d, publicKeyUncompressed: l } = u, p = _.length, m = _[0], B = _.subarray(1);
    if (p === d && (m === 2 || m === 3)) {
      const v = r.fromBytes(B);
      if (!r.isValid(v))
        throw new Error("bad point: is not on curve, wrong x");
      const R = x(v);
      let E;
      try {
        E = r.sqrt(R);
      } catch (W) {
        const C = W instanceof Error ? ": " + W.message : "";
        throw new Error("bad point: is not on curve, sqrt error" + C);
      }
      g();
      const S = r.isOdd(E);
      return (m & 1) === 1 !== S && (E = r.neg(E)), { x: v, y: E };
    } else if (p === l && m === 4) {
      const v = r.BYTES, R = r.fromBytes(B.subarray(0, v)), E = r.fromBytes(B.subarray(v, v * 2));
      if (!A(R, E))
        throw new Error("bad point: is not on curve");
      return { x: R, y: E };
    } else
      throw new Error(`bad point: got length ${p}, expected compressed=${d} or uncompressed=${l}`);
  }
  const y = e.toBytes || f, b = e.fromBytes || w;
  function x(_) {
    const d = r.sqr(_), l = r.mul(d, _);
    return r.add(r.add(l, r.mul(_, i.a)), i.b);
  }
  function A(_, d) {
    const l = r.sqr(d), p = x(_);
    return r.eql(l, p);
  }
  if (!A(i.Gx, i.Gy))
    throw new Error("bad curve params: generator point");
  const O = r.mul(r.pow(i.a, Le), Ur), $ = r.mul(r.sqr(i.b), BigInt(27));
  if (r.is0(r.add(O, $)))
    throw new Error("bad curve params: a or b");
  function z(_, d, l = !1) {
    if (!r.isValid(d) || l && r.is0(d))
      throw new Error(`bad point coordinate ${_}`);
    return d;
  }
  function H(_) {
    if (!(_ instanceof U))
      throw new Error("Weierstrass Point expected");
  }
  function Q(_) {
    if (!c || !c.basises)
      throw new Error("no endo");
    return Hr(_, c.basises, o.ORDER);
  }
  const D = Ut((_, d) => {
    const { X: l, Y: p, Z: m } = _;
    if (r.eql(m, r.ONE))
      return { x: l, y: p };
    const B = _.is0();
    d == null && (d = B ? r.ONE : r.inv(m));
    const v = r.mul(l, d), R = r.mul(p, d), E = r.mul(m, d);
    if (B)
      return { x: r.ZERO, y: r.ZERO };
    if (!r.eql(E, r.ONE))
      throw new Error("invZ was invalid");
    return { x: v, y: R };
  }), j = Ut((_) => {
    if (_.is0()) {
      if (e.allowInfinityPoint && !r.is0(_.Y))
        return;
      throw new Error("bad point: ZERO");
    }
    const { x: d, y: l } = _.toAffine();
    if (!r.isValid(d) || !r.isValid(l))
      throw new Error("bad point: x or y not field elements");
    if (!A(d, l))
      throw new Error("bad point: equation left != right");
    if (!_.isTorsionFree())
      throw new Error("bad point: not in prime-order subgroup");
    return !0;
  });
  function Z(_, d, l, p, m) {
    return l = new U(r.mul(l.X, _), l.Y, l.Z), d = De(p, d), l = De(m, l), d.add(l);
  }
  const T = class T {
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    constructor(d, l, p) {
      h(this, "X");
      h(this, "Y");
      h(this, "Z");
      this.X = z("x", d), this.Y = z("y", l, !0), this.Z = z("z", p), Object.freeze(this);
    }
    static CURVE() {
      return i;
    }
    /** Does NOT validate if the point is valid. Use `.assertValidity()`. */
    static fromAffine(d) {
      const { x: l, y: p } = d || {};
      if (!d || !r.isValid(l) || !r.isValid(p))
        throw new Error("invalid affine point");
      if (d instanceof T)
        throw new Error("projective point not allowed");
      return r.is0(l) && r.is0(p) ? T.ZERO : new T(l, p, r.ONE);
    }
    static fromBytes(d) {
      const l = T.fromAffine(b(N(d, void 0, "point")));
      return l.assertValidity(), l;
    }
    static fromHex(d) {
      return T.fromBytes(P(d));
    }
    get x() {
      return this.toAffine().x;
    }
    get y() {
      return this.toAffine().y;
    }
    /**
     *
     * @param windowSize
     * @param isLazy true will defer table computation until the first multiplication
     * @returns
     */
    precompute(d = 8, l = !0) {
      return V.createCache(this, d), l || this.multiply(Le), this;
    }
    // TODO: return `this`
    /** A point on curve is valid if it conforms to equation. */
    assertValidity() {
      j(this);
    }
    hasEvenY() {
      const { y: d } = this.toAffine();
      if (!r.isOdd)
        throw new Error("Field doesn't support isOdd");
      return !r.isOdd(d);
    }
    /** Compare one point to another. */
    equals(d) {
      H(d);
      const { X: l, Y: p, Z: m } = this, { X: B, Y: v, Z: R } = d, E = r.eql(r.mul(l, R), r.mul(B, m)), S = r.eql(r.mul(p, R), r.mul(v, m));
      return E && S;
    }
    /** Flips point to one corresponding to (x, -y) in Affine coordinates. */
    negate() {
      return new T(this.X, r.neg(this.Y), this.Z);
    }
    // Renes-Costello-Batina exception-free doubling formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 3
    // Cost: 8M + 3S + 3*a + 2*b3 + 15add.
    double() {
      const { a: d, b: l } = i, p = r.mul(l, Le), { X: m, Y: B, Z: v } = this;
      let R = r.ZERO, E = r.ZERO, S = r.ZERO, k = r.mul(m, m), W = r.mul(B, B), C = r.mul(v, v), I = r.mul(m, B);
      return I = r.add(I, I), S = r.mul(m, v), S = r.add(S, S), R = r.mul(d, S), E = r.mul(p, C), E = r.add(R, E), R = r.sub(W, E), E = r.add(W, E), E = r.mul(R, E), R = r.mul(I, R), S = r.mul(p, S), C = r.mul(d, C), I = r.sub(k, C), I = r.mul(d, I), I = r.add(I, S), S = r.add(k, k), k = r.add(S, k), k = r.add(k, C), k = r.mul(k, I), E = r.add(E, k), C = r.mul(B, v), C = r.add(C, C), k = r.mul(C, I), R = r.sub(R, k), S = r.mul(C, W), S = r.add(S, S), S = r.add(S, S), new T(R, E, S);
    }
    // Renes-Costello-Batina exception-free addition formula.
    // There is 30% faster Jacobian formula, but it is not complete.
    // https://eprint.iacr.org/2015/1060, algorithm 1
    // Cost: 12M + 0S + 3*a + 3*b3 + 23add.
    add(d) {
      H(d);
      const { X: l, Y: p, Z: m } = this, { X: B, Y: v, Z: R } = d;
      let E = r.ZERO, S = r.ZERO, k = r.ZERO;
      const W = i.a, C = r.mul(i.b, Le);
      let I = r.mul(l, B), F = r.mul(p, v), Y = r.mul(m, R), ne = r.add(l, p), M = r.add(B, v);
      ne = r.mul(ne, M), M = r.add(I, F), ne = r.sub(ne, M), M = r.add(l, m);
      let X = r.add(B, R);
      return M = r.mul(M, X), X = r.add(I, Y), M = r.sub(M, X), X = r.add(p, m), E = r.add(v, R), X = r.mul(X, E), E = r.add(F, Y), X = r.sub(X, E), k = r.mul(W, M), E = r.mul(C, Y), k = r.add(E, k), E = r.sub(F, k), k = r.add(F, k), S = r.mul(E, k), F = r.add(I, I), F = r.add(F, I), Y = r.mul(W, Y), M = r.mul(C, M), F = r.add(F, Y), Y = r.sub(I, Y), Y = r.mul(W, Y), M = r.add(M, Y), I = r.mul(F, M), S = r.add(S, I), I = r.mul(X, M), E = r.mul(ne, E), E = r.sub(E, I), I = r.mul(ne, F), k = r.mul(X, k), k = r.add(k, I), new T(E, S, k);
    }
    subtract(d) {
      return this.add(d.negate());
    }
    is0() {
      return this.equals(T.ZERO);
    }
    /**
     * Constant time multiplication.
     * Uses wNAF method. Windowed method may be 10% faster,
     * but takes 2x longer to generate and consumes 2x memory.
     * Uses precomputes when available.
     * Uses endomorphism for Koblitz curves.
     * @param scalar by which the point would be multiplied
     * @returns New point
     */
    multiply(d) {
      const { endo: l } = e;
      if (!o.isValidNot0(d))
        throw new Error("invalid scalar: out of range");
      let p, m;
      const B = (v) => V.cached(this, v, (R) => Pt(T, R));
      if (l) {
        const { k1neg: v, k1: R, k2neg: E, k2: S } = Q(d), { p: k, f: W } = B(R), { p: C, f: I } = B(S);
        m = W.add(I), p = Z(l.beta, k, C, v, E);
      } else {
        const { p: v, f: R } = B(d);
        p = v, m = R;
      }
      return Pt(T, [p, m])[0];
    }
    /**
     * Non-constant-time multiplication. Uses double-and-add algorithm.
     * It's faster, but should only be used when you don't care about
     * an exposed secret key e.g. sig verification, which works over *public* keys.
     */
    multiplyUnsafe(d) {
      const { endo: l } = e, p = this;
      if (!o.isValid(d))
        throw new Error("invalid scalar: out of range");
      if (d === ce || p.is0())
        return T.ZERO;
      if (d === ve)
        return p;
      if (V.hasCache(this))
        return this.multiply(d);
      if (l) {
        const { k1neg: m, k1: B, k2neg: v, k2: R } = Q(d), { p1: E, p2: S } = Lr(T, p, B, R);
        return Z(l.beta, E, S, m, v);
      } else
        return V.unsafe(p, d);
    }
    /**
     * Converts Projective point to affine (x, y) coordinates.
     * @param invertedZ Z^-1 (inverted zero) - optional, precomputation is useful for invertBatch
     */
    toAffine(d) {
      return D(this, d);
    }
    /**
     * Checks whether Point is free of torsion elements (is in prime subgroup).
     * Always torsion-free for cofactor=1 curves.
     */
    isTorsionFree() {
      const { isTorsionFree: d } = e;
      return s === ve ? !0 : d ? d(T, this) : V.unsafe(this, a).is0();
    }
    clearCofactor() {
      const { clearCofactor: d } = e;
      return s === ve ? this : d ? d(T, this) : this.multiplyUnsafe(s);
    }
    isSmallOrder() {
      return this.multiplyUnsafe(s).is0();
    }
    toBytes(d = !0) {
      return Pe(d, "isCompressed"), this.assertValidity(), y(T, this, d);
    }
    toHex(d = !0) {
      return q(this.toBytes(d));
    }
    toString() {
      return `<Point ${this.is0() ? "ZERO" : this.toHex()}>`;
    }
  };
  // base / generator point
  h(T, "BASE", new T(i.Gx, i.Gy, r.ONE)), // zero / infinity / identity point
  h(T, "ZERO", new T(r.ZERO, r.ONE, r.ZERO)), // 0, 1, 0
  // math field
  h(T, "Fp", r), // scalar field
  h(T, "Fn", o);
  let U = T;
  const K = o.BITS, V = new Ir(U, e.endo ? Math.ceil(K / 2) : K);
  return U.BASE.precompute(8), U;
}
function xn(t) {
  return Uint8Array.of(t ? 2 : 3);
}
function Sn(t, e) {
  return {
    secretKey: e.BYTES,
    publicKey: 1 + t.BYTES,
    publicKeyUncompressed: 1 + 2 * t.BYTES,
    publicKeyHasPrefix: !0,
    signature: 2 * e.BYTES
  };
}
function qr(t, e = {}) {
  const { Fn: n } = t, r = e.randomBytes || _e, o = Object.assign(Sn(t.Fp, n), { seed: yn(n.ORDER) });
  function i(y) {
    try {
      const b = n.fromBytes(y);
      return n.isValidNot0(b);
    } catch {
      return !1;
    }
  }
  function s(y, b) {
    const { publicKey: x, publicKeyUncompressed: A } = o;
    try {
      const O = y.length;
      return b === !0 && O !== x || b === !1 && O !== A ? !1 : !!t.fromBytes(y);
    } catch {
      return !1;
    }
  }
  function a(y = r(o.seed)) {
    return wn(N(y, o.seed, "seed"), n.ORDER);
  }
  function c(y, b = !0) {
    return t.BASE.multiply(n.fromBytes(y)).toBytes(b);
  }
  function u(y) {
    const { secretKey: b, publicKey: x, publicKeyUncompressed: A } = o;
    if (!mt(y) || "_lengths" in n && n._lengths || b === x)
      return;
    const O = N(y, void 0, "key").length;
    return O === x || O === A;
  }
  function g(y, b, x = !0) {
    if (u(y) === !0)
      throw new Error("first arg must be private key");
    if (u(b) === !1)
      throw new Error("second arg must be public key");
    const A = n.fromBytes(y);
    return t.fromBytes(b).multiply(A).toBytes(x);
  }
  const f = {
    isValidSecretKey: i,
    isValidPublicKey: s,
    randomSecretKey: a
  }, w = En(a, c);
  return Object.freeze({ getPublicKey: c, getSharedSecret: g, keygen: w, Point: t, utils: f, lengths: o });
}
function Pr(t, e, n = {}) {
  je(e), Bt(n, {}, {
    hmac: "function",
    lowS: "boolean",
    randomBytes: "function",
    bits2int: "function",
    bits2int_modN: "function"
  }), n = Object.assign({}, n);
  const r = n.randomBytes || _e, o = n.hmac || ((d, l) => ke(e, d, l)), { Fp: i, Fn: s } = t, { ORDER: a, BITS: c } = s, { keygen: u, getPublicKey: g, getSharedSecret: f, utils: w, lengths: y } = qr(t, n), b = {
    prehash: !0,
    lowS: typeof n.lowS == "boolean" ? n.lowS : !0,
    format: "compact",
    extraEntropy: !1
  }, x = a * vn < i.ORDER;
  function A(d) {
    const l = a >> ve;
    return d > l;
  }
  function O(d, l) {
    if (!s.isValidNot0(l))
      throw new Error(`invalid signature ${d}: out of range 1..Point.Fn.ORDER`);
    return l;
  }
  function $() {
    if (x)
      throw new Error('"recovered" sig type is not supported for cofactor >2 curves');
  }
  function z(d, l) {
    dt(l);
    const p = y.signature, m = l === "compact" ? p : l === "recovered" ? p + 1 : void 0;
    return N(d, m);
  }
  class H {
    constructor(l, p, m) {
      h(this, "r");
      h(this, "s");
      h(this, "recovery");
      if (this.r = O("r", l), this.s = O("s", p), m != null) {
        if ($(), ![0, 1, 2, 3].includes(m))
          throw new Error("invalid recovery id");
        this.recovery = m;
      }
      Object.freeze(this);
    }
    static fromBytes(l, p = b.format) {
      z(l, p);
      let m;
      if (p === "der") {
        const { r: E, s: S } = le.toSig(N(l));
        return new H(E, S);
      }
      p === "recovered" && (m = l[0], p = "compact", l = l.subarray(1));
      const B = y.signature / 2, v = l.subarray(0, B), R = l.subarray(B, B * 2);
      return new H(s.fromBytes(v), s.fromBytes(R), m);
    }
    static fromHex(l, p) {
      return this.fromBytes(P(l), p);
    }
    assertRecovery() {
      const { recovery: l } = this;
      if (l == null)
        throw new Error("invalid recovery id: must be present");
      return l;
    }
    addRecoveryBit(l) {
      return new H(this.r, this.s, l);
    }
    recoverPublicKey(l) {
      const { r: p, s: m } = this, B = this.assertRecovery(), v = B === 2 || B === 3 ? p + a : p;
      if (!i.isValid(v))
        throw new Error("invalid recovery id: sig.r+curve.n != R.x");
      const R = i.toBytes(v), E = t.fromBytes(ee(xn((B & 1) === 0), R)), S = s.inv(v), k = D(N(l, void 0, "msgHash")), W = s.create(-k * S), C = s.create(m * S), I = t.BASE.multiplyUnsafe(W).add(E.multiplyUnsafe(C));
      if (I.is0())
        throw new Error("invalid recovery: point at infinify");
      return I.assertValidity(), I;
    }
    // Signatures should be low-s, to prevent malleability.
    hasHighS() {
      return A(this.s);
    }
    toBytes(l = b.format) {
      if (dt(l), l === "der")
        return P(le.hexFromSig(this));
      const { r: p, s: m } = this, B = s.toBytes(p), v = s.toBytes(m);
      return l === "recovered" ? ($(), ee(Uint8Array.of(this.assertRecovery()), B, v)) : ee(B, v);
    }
    toHex(l) {
      return q(this.toBytes(l));
    }
  }
  const Q = n.bits2int || function(l) {
    if (l.length > 8192)
      throw new Error("input is too large");
    const p = Te(l), m = l.length * 8 - c;
    return m > 0 ? p >> BigInt(m) : p;
  }, D = n.bits2int_modN || function(l) {
    return s.create(Q(l));
  }, j = St(c);
  function Z(d) {
    return pr("num < 2^" + c, d, ce, j), s.toBytes(d);
  }
  function U(d, l) {
    return N(d, void 0, "message"), l ? N(e(d), void 0, "prehashed message") : d;
  }
  function K(d, l, p) {
    const { lowS: m, prehash: B, extraEntropy: v } = it(p, b);
    d = U(d, B);
    const R = D(d), E = s.fromBytes(l);
    if (!s.isValidNot0(E))
      throw new Error("invalid private key");
    const S = [Z(E), Z(R)];
    if (v != null && v !== !1) {
      const I = v === !0 ? r(y.secretKey) : v;
      S.push(N(I, void 0, "extraEntropy"));
    }
    const k = ee(...S), W = R;
    function C(I) {
      const F = Q(I);
      if (!s.isValidNot0(F))
        return;
      const Y = s.inv(F), ne = t.BASE.multiply(F).toAffine(), M = s.create(ne.x);
      if (M === ce)
        return;
      const X = s.create(Y * s.create(W + M * E));
      if (X === ce)
        return;
      let $t = (ne.x === M ? 0 : 2) | Number(ne.y & ve), Ht = X;
      return m && A(X) && (Ht = s.neg(X), $t ^= 1), new H(M, Ht, x ? void 0 : $t);
    }
    return { seed: k, k2sig: C };
  }
  function V(d, l, p = {}) {
    const { seed: m, k2sig: B } = K(d, l, p);
    return mr(e.outputLen, s.BYTES, o)(m, B).toBytes(p.format);
  }
  function T(d, l, p, m = {}) {
    const { lowS: B, prehash: v, format: R } = it(m, b);
    if (p = N(p, void 0, "publicKey"), l = U(l, v), !mt(d)) {
      const E = d instanceof H ? ", use sig.toBytes()" : "";
      throw new Error("verify expects Uint8Array signature" + E);
    }
    z(d, R);
    try {
      const E = H.fromBytes(d, R), S = t.fromBytes(p);
      if (B && E.hasHighS())
        return !1;
      const { r: k, s: W } = E, C = D(l), I = s.inv(W), F = s.create(C * I), Y = s.create(k * I), ne = t.BASE.multiplyUnsafe(F).add(S.multiplyUnsafe(Y));
      return ne.is0() ? !1 : s.create(ne.x) === k;
    } catch {
      return !1;
    }
  }
  function _(d, l, p = {}) {
    const { prehash: m } = it(p, b);
    return l = U(l, m), H.fromBytes(d, "recovered").recoverPublicKey(l).toBytes();
  }
  return Object.freeze({
    keygen: u,
    getPublicKey: g,
    getSharedSecret: f,
    utils: w,
    lengths: y,
    Point: t,
    sign: V,
    verify: T,
    recoverPublicKey: _,
    Signature: H,
    hash: e
  });
}
/*! noble-curves - MIT License (c) 2022 Paul Miller (paulmillr.com) */
const Ye = {
  p: BigInt("0xfffffffffffffffffffffffffffffffffffffffffffffffffffffffefffffc2f"),
  n: BigInt("0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141"),
  h: BigInt(1),
  a: BigInt(0),
  b: BigInt(7),
  Gx: BigInt("0x79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798"),
  Gy: BigInt("0x483ada7726a3c4655da4fbfc0e1108a8fd17b448a68554199c47d08ffb10d4b8")
}, Dr = {
  beta: BigInt("0x7ae96a2b657c07106e64479eac3434e99cf0497512f58995c1396c28719501ee"),
  basises: [
    [BigInt("0x3086d221a7d46bcde86c90e49284eb15"), -BigInt("0xe4437ed6010e88286f547fa90abfe4c3")],
    [BigInt("0x114ca50f7a8e2f3f657c1108d9d44cfd8"), BigInt("0x3086d221a7d46bcde86c90e49284eb15")]
  ]
}, Vr = /* @__PURE__ */ BigInt(0), ht = /* @__PURE__ */ BigInt(2);
function Mr(t) {
  const e = Ye.p, n = BigInt(3), r = BigInt(6), o = BigInt(11), i = BigInt(22), s = BigInt(23), a = BigInt(44), c = BigInt(88), u = t * t * t % e, g = u * u * t % e, f = re(g, n, e) * g % e, w = re(f, n, e) * g % e, y = re(w, ht, e) * u % e, b = re(y, o, e) * y % e, x = re(b, i, e) * b % e, A = re(x, a, e) * x % e, O = re(A, c, e) * A % e, $ = re(O, a, e) * x % e, z = re($, n, e) * g % e, H = re(z, s, e) * b % e, Q = re(H, r, e) * u % e, D = re(Q, ht, e);
  if (!Ve.eql(Ve.sqr(D), t))
    throw new Error("Cannot find square root");
  return D;
}
const Ve = Fe(Ye.p, { sqrt: Mr }), pe = /* @__PURE__ */ Cr(Ye, {
  Fp: Ve,
  endo: Dr
}), zr = /* @__PURE__ */ Pr(pe, ae), Zt = {};
function Me(t, ...e) {
  let n = Zt[t];
  if (n === void 0) {
    const r = ae(wr(t));
    n = ee(r, r), Zt[t] = n;
  }
  return ae(ee(n, ...e));
}
const Rt = (t) => t.toBytes(!0).slice(1), Ot = (t) => t % ht === Vr;
function gt(t) {
  const { Fn: e, BASE: n } = pe, r = e.fromBytes(t), o = n.multiply(r);
  return { scalar: Ot(o.y) ? r : e.neg(r), bytes: Rt(o) };
}
function Bn(t) {
  const e = Ve;
  if (!e.isValidNot0(t))
    throw new Error("invalid x: Fail if x ≥ p");
  const n = e.create(t * t), r = e.create(n * t + BigInt(7));
  let o = e.sqrt(r);
  Ot(o) || (o = e.neg(o));
  const i = pe.fromAffine({ x: t, y: o });
  return i.assertValidity(), i;
}
const Re = Te;
function An(...t) {
  return pe.Fn.create(Re(Me("BIP0340/challenge", ...t)));
}
function Kt(t) {
  return gt(t).bytes;
}
function Zr(t, e, n = _e(32)) {
  const { Fn: r } = pe, o = N(t, void 0, "message"), { bytes: i, scalar: s } = gt(e), a = N(n, 32, "auxRand"), c = r.toBytes(s ^ Re(Me("BIP0340/aux", a))), u = Me("BIP0340/nonce", c, i, o), { bytes: g, scalar: f } = gt(u), w = An(g, i, o), y = new Uint8Array(64);
  if (y.set(g, 0), y.set(r.toBytes(r.create(f + w * s)), 32), !Rn(y, o, i))
    throw new Error("sign: Invalid signature produced");
  return y;
}
function Rn(t, e, n) {
  const { Fp: r, Fn: o, BASE: i } = pe, s = N(t, 64, "signature"), a = N(e, void 0, "message"), c = N(n, 32, "publicKey");
  try {
    const u = Bn(Re(c)), g = Re(s.subarray(0, 32));
    if (!r.isValidNot0(g))
      return !1;
    const f = Re(s.subarray(32, 64));
    if (!o.isValidNot0(f))
      return !1;
    const w = An(o.toBytes(g), Rt(u), a), y = i.multiplyUnsafe(f).add(u.multiplyUnsafe(o.neg(w))), { x: b, y: x } = y.toAffine();
    return !(y.is0() || !Ot(x) || b !== g);
  } catch {
    return !1;
  }
}
const G = /* @__PURE__ */ (() => {
  const n = (r = _e(48)) => wn(r, Ye.n);
  return {
    keygen: En(n, Kt),
    getPublicKey: Kt,
    sign: Zr,
    verify: Rn,
    Point: pe,
    utils: {
      randomSecretKey: n,
      taggedHash: Me,
      lift_x: Bn,
      pointToBytes: Rt
    },
    lengths: {
      secretKey: 32,
      publicKey: 32,
      publicKeyHasPrefix: !1,
      signature: 32 * 2,
      seed: 48
    }
  };
})();
var ge = Symbol("verified"), Kr = (t) => t instanceof Object;
function Wr(t) {
  if (!Kr(t) || typeof t.kind != "number" || typeof t.content != "string" || typeof t.created_at != "number" || typeof t.pubkey != "string" || !t.pubkey.match(/^[a-f0-9]{64}$/) || !Array.isArray(t.tags))
    return !1;
  for (let e = 0; e < t.tags.length; e++) {
    let n = t.tags[e];
    if (!Array.isArray(n))
      return !1;
    for (let r = 0; r < n.length; r++)
      if (typeof n[r] != "string")
        return !1;
  }
  return !0;
}
new TextDecoder("utf-8");
var jr = new TextEncoder();
function Ae(t) {
  try {
    t.indexOf("://") === -1 && (t = "wss://" + t);
    let e = new URL(t);
    return e.protocol === "http:" ? e.protocol = "ws:" : e.protocol === "https:" && (e.protocol = "wss:"), e.pathname = e.pathname.replace(/\/+/g, "/"), e.pathname.endsWith("/") && (e.pathname = e.pathname.slice(0, -1)), (e.port === "80" && e.protocol === "ws:" || e.port === "443" && e.protocol === "wss:") && (e.port = ""), e.searchParams.sort(), e.hash = "", e.toString();
  } catch {
    throw new Error(`Invalid URL: ${t}`);
  }
}
var Fr = class {
  generateSecretKey() {
    return G.utils.randomSecretKey();
  }
  getPublicKey(e) {
    return q(G.getPublicKey(e));
  }
  finalizeEvent(e, n) {
    const r = e;
    return r.pubkey = q(G.getPublicKey(n)), r.id = st(r), r.sig = q(G.sign(P(st(r)), n)), r[ge] = !0, r;
  }
  verifyEvent(e) {
    if (typeof e[ge] == "boolean")
      return e[ge];
    try {
      const n = st(e);
      if (n !== e.id)
        return e[ge] = !1, !1;
      const r = G.verify(P(e.sig), P(n), P(e.pubkey));
      return e[ge] = r, r;
    } catch {
      return e[ge] = !1, !1;
    }
  }
};
function Yr(t) {
  if (!Wr(t))
    throw new Error("can't serialize event with wrong or missing properties");
  return JSON.stringify([0, t.pubkey, t.created_at, t.kind, t.tags, t.content]);
}
function st(t) {
  let e = ae(jr.encode(Yr(t)));
  return q(e);
}
var Xe = new Fr();
Xe.generateSecretKey;
Xe.getPublicKey;
Xe.finalizeEvent;
var Xr = Xe.verifyEvent, Gr = 22242;
function Jr(t, e) {
  if (t.ids && t.ids.indexOf(e.id) === -1 || t.kinds && t.kinds.indexOf(e.kind) === -1 || t.authors && t.authors.indexOf(e.pubkey) === -1)
    return !1;
  for (let n in t)
    if (n[0] === "#") {
      let r = n.slice(1), o = t[`#${r}`];
      if (o && !e.tags.find(([i, s]) => i === n.slice(1) && o.indexOf(s) !== -1))
        return !1;
    }
  return !(t.since && e.created_at < t.since || t.until && e.created_at > t.until);
}
function Qr(t, e) {
  for (let n = 0; n < t.length; n++)
    if (Jr(t[n], e))
      return !0;
  return !1;
}
function eo(t, e) {
  let n = e.length + 3, r = t.indexOf(`"${e}":`) + n, o = t.slice(r).indexOf('"') + r + 1;
  return t.slice(o, o + 64);
}
function to(t) {
  let e = t.slice(0, 22).indexOf('"EVENT"');
  if (e === -1)
    return null;
  let n = t.slice(e + 7 + 1).indexOf('"');
  if (n === -1)
    return null;
  let r = e + 7 + 1 + n, o = t.slice(r + 1, 80).indexOf('"');
  if (o === -1)
    return null;
  let i = r + 1 + o;
  return t.slice(r + 1, i);
}
function no(t, e) {
  return {
    kind: Gr,
    created_at: Math.floor(Date.now() / 1e3),
    tags: [
      ["relay", t],
      ["challenge", e]
    ],
    content: ""
  };
}
var On = class extends Error {
  constructor(t, e) {
    super(`Tried to send message '${t} on a closed connection to ${e}.`), this.name = "SendingOnClosedConnection";
  }
}, _n = class {
  constructor(t, e) {
    h(this, "url");
    h(this, "_connected", !1);
    h(this, "onclose", null);
    h(this, "onnotice", (t) => console.debug(`NOTICE from ${this.url}: ${t}`));
    h(this, "onauth");
    h(this, "baseEoseTimeout", 4400);
    h(this, "publishTimeout", 4400);
    h(this, "pingFrequency", 29e3);
    h(this, "pingTimeout", 2e4);
    h(this, "resubscribeBackoff", [1e4, 1e4, 1e4, 2e4, 2e4, 3e4, 6e4]);
    h(this, "openSubs", /* @__PURE__ */ new Map());
    h(this, "enablePing");
    h(this, "enableReconnect");
    h(this, "idleSince", Date.now());
    h(this, "ongoingOperations", 0);
    h(this, "reconnectTimeoutHandle");
    h(this, "pingIntervalHandle");
    h(this, "reconnectAttempts", 0);
    h(this, "skipReconnection", !1);
    h(this, "connectionPromise");
    h(this, "openCountRequests", /* @__PURE__ */ new Map());
    h(this, "openEventPublishes", /* @__PURE__ */ new Map());
    h(this, "ws");
    h(this, "challenge");
    h(this, "authPromise");
    h(this, "serial", 0);
    h(this, "verifyEvent");
    h(this, "_WebSocket");
    this.url = Ae(t), this.verifyEvent = e.verifyEvent, this._WebSocket = e.websocketImplementation || WebSocket, this.enablePing = e.enablePing, this.enableReconnect = e.enableReconnect || !1;
  }
  static async connect(t, e) {
    const n = new _n(t, e);
    return await n.connect(e), n;
  }
  closeAllSubscriptions(t) {
    for (let [e, n] of this.openSubs)
      n.close(t);
    this.openSubs.clear();
    for (let [e, n] of this.openEventPublishes)
      n.reject(new Error(t));
    this.openEventPublishes.clear();
    for (let [e, n] of this.openCountRequests)
      n.reject(new Error(t));
    this.openCountRequests.clear();
  }
  get connected() {
    return this._connected;
  }
  async reconnect() {
    const t = this.resubscribeBackoff[Math.min(this.reconnectAttempts, this.resubscribeBackoff.length - 1)];
    this.reconnectAttempts++, this.reconnectTimeoutHandle = setTimeout(async () => {
      try {
        await this.connect();
      } catch {
      }
    }, t);
  }
  handleHardClose(t) {
    var e;
    this.pingIntervalHandle && (clearInterval(this.pingIntervalHandle), this.pingIntervalHandle = void 0), this._connected = !1, this.connectionPromise = void 0, this.idleSince = void 0, this.enableReconnect && !this.skipReconnection ? this.reconnect() : ((e = this.onclose) == null || e.call(this), this.closeAllSubscriptions(t));
  }
  async connect(t) {
    let e;
    return this.connectionPromise ? this.connectionPromise : (this.challenge = void 0, this.authPromise = void 0, this.skipReconnection = !1, this.connectionPromise = new Promise((n, r) => {
      t != null && t.timeout && (e = setTimeout(() => {
        var o;
        r("connection timed out"), this.connectionPromise = void 0, this.skipReconnection = !0, (o = this.onclose) == null || o.call(this), this.handleHardClose("relay connection timed out");
      }, t.timeout)), t != null && t.abort && (t.abort.onabort = r);
      try {
        this.ws = new this._WebSocket(this.url);
      } catch (o) {
        clearTimeout(e), r(o);
        return;
      }
      this.ws.onopen = () => {
        this.reconnectTimeoutHandle && (clearTimeout(this.reconnectTimeoutHandle), this.reconnectTimeoutHandle = void 0), clearTimeout(e), this._connected = !0;
        const o = this.reconnectAttempts > 0;
        this.reconnectAttempts = 0;
        for (const i of this.openSubs.values()) {
          if (i.eosed = !1, o)
            for (let s = 0; s < i.filters.length; s++)
              i.lastEmitted && (i.filters[s].since = i.lastEmitted + 1);
          i.fire();
        }
        this.enablePing && (this.pingIntervalHandle = setInterval(() => this.pingpong(), this.pingFrequency)), n();
      }, this.ws.onerror = () => {
        var o;
        clearTimeout(e), r("connection failed"), this.connectionPromise = void 0, this.skipReconnection = !0, (o = this.onclose) == null || o.call(this), this.handleHardClose("relay connection failed");
      }, this.ws.onclose = (o) => {
        clearTimeout(e), r(o.message || "websocket closed"), this.handleHardClose("relay connection closed");
      }, this.ws.onmessage = this._onmessage.bind(this);
    }), this.connectionPromise);
  }
  waitForPingPong() {
    return new Promise((t) => {
      this.ws.once("pong", () => t(!0)), this.ws.ping();
    });
  }
  waitForDummyReq() {
    return new Promise((t, e) => {
      if (!this.connectionPromise)
        return e(new Error(`no connection to ${this.url}, can't ping`));
      try {
        const n = this.subscribe(
          [{ ids: ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"], limit: 0 }],
          {
            label: "<forced-ping>",
            oneose: () => {
              t(!0), n.close();
            },
            onclose() {
              t(!0);
            },
            eoseTimeout: this.pingTimeout + 1e3
          }
        );
      } catch (n) {
        e(n);
      }
    });
  }
  async pingpong() {
    var t, e, n;
    ((t = this.ws) == null ? void 0 : t.readyState) === 1 && (await Promise.any([
      this.ws && this.ws.ping && this.ws.once ? this.waitForPingPong() : this.waitForDummyReq(),
      new Promise((o) => setTimeout(() => o(!1), this.pingTimeout))
    ]) || ((e = this.ws) == null ? void 0 : e.readyState) === this._WebSocket.OPEN && ((n = this.ws) == null || n.close()));
  }
  async send(t) {
    if (!this.connectionPromise)
      throw new On(t, this.url);
    this.connectionPromise.then(() => {
      var e;
      (e = this.ws) == null || e.send(t);
    });
  }
  async auth(t) {
    const e = this.challenge;
    if (!e)
      throw new Error("can't perform auth, no challenge was received");
    return this.authPromise ? this.authPromise : (this.authPromise = new Promise(async (n, r) => {
      try {
        let o = await t(no(this.url, e)), i = setTimeout(() => {
          let s = this.openEventPublishes.get(o.id);
          s && (s.reject(new Error("auth timed out")), this.openEventPublishes.delete(o.id));
        }, this.publishTimeout);
        this.openEventPublishes.set(o.id, { resolve: n, reject: r, timeout: i }), this.send('["AUTH",' + JSON.stringify(o) + "]");
      } catch (o) {
        console.warn("subscribe auth function failed:", o);
      }
    }), this.authPromise);
  }
  async publish(t) {
    this.idleSince = void 0, this.ongoingOperations++;
    const e = new Promise((n, r) => {
      const o = setTimeout(() => {
        const i = this.openEventPublishes.get(t.id);
        i && (i.reject(new Error("publish timed out")), this.openEventPublishes.delete(t.id));
      }, this.publishTimeout);
      this.openEventPublishes.set(t.id, { resolve: n, reject: r, timeout: o });
    });
    return this.send('["EVENT",' + JSON.stringify(t) + "]"), this.ongoingOperations--, this.ongoingOperations === 0 && (this.idleSince = Date.now()), e;
  }
  async count(t, e) {
    this.serial++;
    const n = (e == null ? void 0 : e.id) || "count:" + this.serial, r = new Promise((o, i) => {
      this.openCountRequests.set(n, { resolve: o, reject: i });
    });
    return this.send('["COUNT","' + n + '",' + JSON.stringify(t).substring(1)), r;
  }
  subscribe(t, e) {
    e.label !== "<forced-ping>" && (this.idleSince = void 0, this.ongoingOperations++);
    const n = this.prepareSubscription(t, e);
    return n.fire(), e.abort && (e.abort.onabort = () => n.close(String(e.abort.reason || "<aborted>"))), n;
  }
  prepareSubscription(t, e) {
    this.serial++;
    const n = e.id || (e.label ? e.label + ":" : "sub:") + this.serial, r = new ro(this, n, t, e);
    return this.openSubs.set(n, r), r;
  }
  close() {
    var t, e, n;
    this.skipReconnection = !0, this.reconnectTimeoutHandle && (clearTimeout(this.reconnectTimeoutHandle), this.reconnectTimeoutHandle = void 0), this.pingIntervalHandle && (clearInterval(this.pingIntervalHandle), this.pingIntervalHandle = void 0), this.closeAllSubscriptions("relay connection closed by us"), this._connected = !1, this.idleSince = void 0, (t = this.onclose) == null || t.call(this), ((e = this.ws) == null ? void 0 : e.readyState) === this._WebSocket.OPEN && ((n = this.ws) == null || n.close());
  }
  _onmessage(t) {
    var r, o, i, s;
    const e = t.data;
    if (!e)
      return;
    const n = to(e);
    if (n) {
      const a = this.openSubs.get(n);
      if (!a)
        return;
      const c = eo(e, "id"), u = (r = a.alreadyHaveEvent) == null ? void 0 : r.call(a, c);
      if ((o = a.receivedEvent) == null || o.call(a, this, c), u)
        return;
    }
    try {
      let a = JSON.parse(e);
      switch (a[0]) {
        case "EVENT": {
          const c = this.openSubs.get(a[1]), u = a[2];
          this.verifyEvent(u) && Qr(c.filters, u) ? c.onevent(u) : (i = c.oninvalidevent) == null || i.call(c, u), (!c.lastEmitted || c.lastEmitted < u.created_at) && (c.lastEmitted = u.created_at);
          return;
        }
        case "COUNT": {
          const c = a[1], u = a[2], g = this.openCountRequests.get(c);
          g && (g.resolve(u.count), this.openCountRequests.delete(c));
          return;
        }
        case "EOSE": {
          const c = this.openSubs.get(a[1]);
          if (!c)
            return;
          c.receivedEose();
          return;
        }
        case "OK": {
          const c = a[1], u = a[2], g = a[3], f = this.openEventPublishes.get(c);
          f && (clearTimeout(f.timeout), u ? f.resolve(g) : f.reject(new Error(g)), this.openEventPublishes.delete(c));
          return;
        }
        case "CLOSED": {
          const c = a[1], u = this.openSubs.get(c);
          if (!u)
            return;
          u.closed = !0, u.close(a[2]);
          return;
        }
        case "NOTICE": {
          this.onnotice(a[1]);
          return;
        }
        case "AUTH": {
          this.challenge = a[1], this.onauth && this.auth(this.onauth);
          return;
        }
        default: {
          const c = this.openSubs.get(a[1]);
          (s = c == null ? void 0 : c.oncustom) == null || s.call(c, a);
          return;
        }
      }
    } catch (a) {
      try {
        const [c, u, g] = JSON.parse(e);
        console.warn(`[nostr] relay ${this.url} error processing message:`, a, g);
      } catch {
        console.warn(`[nostr] relay ${this.url} error processing message:`, a);
      }
      return;
    }
  }
}, ro = class {
  constructor(t, e, n, r) {
    h(this, "relay");
    h(this, "id");
    h(this, "lastEmitted");
    h(this, "closed", !1);
    h(this, "eosed", !1);
    h(this, "filters");
    h(this, "alreadyHaveEvent");
    h(this, "receivedEvent");
    h(this, "onevent");
    h(this, "oninvalidevent");
    h(this, "oneose");
    h(this, "onclose");
    h(this, "oncustom");
    h(this, "eoseTimeout");
    h(this, "eoseTimeoutHandle");
    if (n.length === 0)
      throw new Error("subscription can't be created with zero filters");
    this.relay = t, this.filters = n, this.id = e, this.alreadyHaveEvent = r.alreadyHaveEvent, this.receivedEvent = r.receivedEvent, this.eoseTimeout = r.eoseTimeout || t.baseEoseTimeout, this.oneose = r.oneose, this.onclose = r.onclose, this.oninvalidevent = r.oninvalidevent, this.onevent = r.onevent || ((o) => {
      console.warn(
        `onevent() callback not defined for subscription '${this.id}' in relay ${this.relay.url}. event received:`,
        o
      );
    });
  }
  fire() {
    this.relay.send('["REQ","' + this.id + '",' + JSON.stringify(this.filters).substring(1)), this.eoseTimeoutHandle = setTimeout(this.receivedEose.bind(this), this.eoseTimeout);
  }
  receivedEose() {
    var t;
    this.eosed || (clearTimeout(this.eoseTimeoutHandle), this.eosed = !0, (t = this.oneose) == null || t.call(this));
  }
  close(t = "closed by caller") {
    var e;
    if (!this.closed && this.relay.connected) {
      try {
        this.relay.send('["CLOSE",' + JSON.stringify(this.id) + "]");
      } catch (n) {
        if (!(n instanceof On)) throw n;
      }
      this.closed = !0;
    }
    this.relay.openSubs.delete(this.id), this.relay.ongoingOperations--, this.relay.ongoingOperations === 0 && (this.relay.idleSince = Date.now()), (e = this.onclose) == null || e.call(this, t);
  }
}, oo = (t) => (t[ge] = !0, !0), io = class {
  constructor(t) {
    h(this, "relays", /* @__PURE__ */ new Map());
    h(this, "seenOn", /* @__PURE__ */ new Map());
    h(this, "trackRelays", !1);
    h(this, "verifyEvent");
    h(this, "enablePing");
    h(this, "enableReconnect");
    h(this, "automaticallyAuth");
    h(this, "trustedRelayURLs", /* @__PURE__ */ new Set());
    h(this, "onRelayConnectionFailure");
    h(this, "onRelayConnectionSuccess");
    h(this, "allowConnectingToRelay");
    h(this, "maxWaitForConnection");
    h(this, "_WebSocket");
    this.verifyEvent = t.verifyEvent, this._WebSocket = t.websocketImplementation, this.enablePing = t.enablePing, this.enableReconnect = t.enableReconnect || !1, this.automaticallyAuth = t.automaticallyAuth, this.onRelayConnectionFailure = t.onRelayConnectionFailure, this.onRelayConnectionSuccess = t.onRelayConnectionSuccess, this.allowConnectingToRelay = t.allowConnectingToRelay, this.maxWaitForConnection = t.maxWaitForConnection || 3e3;
  }
  async ensureRelay(t, e) {
    t = Ae(t);
    let n = this.relays.get(t);
    if (n || (n = new _n(t, {
      verifyEvent: this.trustedRelayURLs.has(t) ? oo : this.verifyEvent,
      websocketImplementation: this._WebSocket,
      enablePing: this.enablePing,
      enableReconnect: this.enableReconnect
    }), n.onclose = () => {
      this.relays.delete(t);
    }, this.relays.set(t, n)), this.automaticallyAuth) {
      const r = this.automaticallyAuth(t);
      r && (n.onauth = r);
    }
    try {
      await n.connect({
        timeout: e == null ? void 0 : e.connectionTimeout,
        abort: e == null ? void 0 : e.abort
      });
    } catch (r) {
      throw this.relays.delete(t), r;
    }
    return n;
  }
  close(t) {
    t.map(Ae).forEach((e) => {
      var n;
      (n = this.relays.get(e)) == null || n.close(), this.relays.delete(e);
    });
  }
  subscribe(t, e, n) {
    const r = [], o = [];
    for (let i = 0; i < t.length; i++) {
      const s = Ae(t[i]);
      r.find((a) => a.url === s) || o.indexOf(s) === -1 && (o.push(s), r.push({ url: s, filter: e }));
    }
    return this.subscribeMap(r, n);
  }
  subscribeMany(t, e, n) {
    return this.subscribe(t, e, n);
  }
  subscribeMap(t, e) {
    const n = /* @__PURE__ */ new Map();
    for (const w of t) {
      const { url: y, filter: b } = w;
      n.has(y) || n.set(y, []), n.get(y).push(b);
    }
    const r = Array.from(n.entries()).map(([w, y]) => ({ url: w, filters: y }));
    this.trackRelays && (e.receivedEvent = (w, y) => {
      let b = this.seenOn.get(y);
      b || (b = /* @__PURE__ */ new Set(), this.seenOn.set(y, b)), b.add(w);
    });
    const o = /* @__PURE__ */ new Set(), i = [], s = [];
    let a = (w) => {
      var y;
      s[w] || (s[w] = !0, s.filter((b) => b).length === r.length && ((y = e.oneose) == null || y.call(e), a = () => {
      }));
    };
    const c = [];
    let u = (w, y) => {
      var b;
      c[w] || (a(w), c[w] = y, c.filter((x) => x).length === r.length && ((b = e.onclose) == null || b.call(e, c), u = () => {
      }));
    };
    const g = (w) => {
      var b;
      if ((b = e.alreadyHaveEvent) != null && b.call(e, w))
        return !0;
      const y = o.has(w);
      return o.add(w), y;
    }, f = Promise.all(
      r.map(async ({ url: w, filters: y }, b) => {
        var O, $, z;
        if (((O = this.allowConnectingToRelay) == null ? void 0 : O.call(this, w, ["read", y])) === !1) {
          u(b, "connection skipped by allowConnectingToRelay");
          return;
        }
        let x;
        try {
          x = await this.ensureRelay(w, {
            connectionTimeout: this.maxWaitForConnection < (e.maxWait || 0) ? Math.max(e.maxWait * 0.8, e.maxWait - 1e3) : this.maxWaitForConnection,
            abort: e.abort
          });
        } catch (H) {
          ($ = this.onRelayConnectionFailure) == null || $.call(this, w), u(b, (H == null ? void 0 : H.message) || String(H));
          return;
        }
        (z = this.onRelayConnectionSuccess) == null || z.call(this, w);
        let A = x.subscribe(y, {
          ...e,
          oneose: () => a(b),
          onclose: (H) => {
            H.startsWith("auth-required: ") && e.onauth ? x.auth(e.onauth).then(() => {
              x.subscribe(y, {
                ...e,
                oneose: () => a(b),
                onclose: (Q) => {
                  u(b, Q);
                },
                alreadyHaveEvent: g,
                eoseTimeout: e.maxWait,
                abort: e.abort
              });
            }).catch((Q) => {
              u(b, `auth was required and attempted, but failed with: ${Q}`);
            }) : u(b, H);
          },
          alreadyHaveEvent: g,
          eoseTimeout: e.maxWait,
          abort: e.abort
        });
        i.push(A);
      })
    );
    return {
      async close(w) {
        await f, i.forEach((y) => {
          y.close(w);
        });
      }
    };
  }
  subscribeEose(t, e, n) {
    let r;
    return r = this.subscribe(t, e, {
      ...n,
      oneose() {
        var i;
        const o = "closed automatically on eose";
        r ? r.close(o) : (i = n.onclose) == null || i.call(n, t.map((s) => o));
      }
    }), r;
  }
  subscribeManyEose(t, e, n) {
    return this.subscribeEose(t, e, n);
  }
  async querySync(t, e, n) {
    return new Promise(async (r) => {
      const o = [];
      this.subscribeEose(t, e, {
        ...n,
        onevent(i) {
          o.push(i);
        },
        onclose(i) {
          r(o);
        }
      });
    });
  }
  async get(t, e, n) {
    e.limit = 1;
    const r = await this.querySync(t, e, n);
    return r.sort((o, i) => i.created_at - o.created_at), r[0] || null;
  }
  publish(t, e, n) {
    return t.map(Ae).map(async (r, o, i) => {
      var a, c;
      if (i.indexOf(r) !== o)
        return Promise.reject("duplicate url");
      if (((a = this.allowConnectingToRelay) == null ? void 0 : a.call(this, r, ["write", e])) === !1)
        return Promise.reject("connection skipped by allowConnectingToRelay");
      let s;
      try {
        s = await this.ensureRelay(r, {
          connectionTimeout: this.maxWaitForConnection < ((n == null ? void 0 : n.maxWait) || 0) ? Math.max(n.maxWait * 0.8, n.maxWait - 1e3) : this.maxWaitForConnection,
          abort: n == null ? void 0 : n.abort
        });
      } catch (u) {
        return (c = this.onRelayConnectionFailure) == null || c.call(this, r), "connection failure: " + String(u);
      }
      return s.publish(e).catch(async (u) => {
        if (u instanceof Error && u.message.startsWith("auth-required: ") && (n != null && n.onauth))
          return await s.auth(n.onauth), s.publish(e);
        throw u;
      }).then((u) => {
        if (this.trackRelays) {
          let g = this.seenOn.get(e.id);
          g || (g = /* @__PURE__ */ new Set(), this.seenOn.set(e.id, g)), g.add(s);
        }
        return u;
      });
    });
  }
  listConnectionStatus() {
    const t = /* @__PURE__ */ new Map();
    return this.relays.forEach((e, n) => t.set(n, e.connected)), t;
  }
  destroy() {
    this.relays.forEach((t) => t.close()), this.relays = /* @__PURE__ */ new Map();
  }
  pruneIdleRelays(t = 1e4) {
    const e = [];
    for (const [n, r] of this.relays)
      r.idleSince && Date.now() - r.idleSince >= t && (this.relays.delete(n), e.push(n), r.close());
    return e;
  }
}, Tn;
try {
  Tn = WebSocket;
} catch {
}
var ai = class extends io {
  constructor(t) {
    super({ verifyEvent: Xr, websocketImplementation: Tn, maxWaitForConnection: 3e3, ...t });
  }
}, Ee = Symbol("verified"), so = (t) => t instanceof Object;
function co(t) {
  if (!so(t) || typeof t.kind != "number" || typeof t.content != "string" || typeof t.created_at != "number" || typeof t.pubkey != "string" || !t.pubkey.match(/^[a-f0-9]{64}$/) || !Array.isArray(t.tags))
    return !1;
  for (let e = 0; e < t.tags.length; e++) {
    let n = t.tags[e];
    if (!Array.isArray(n))
      return !1;
    for (let r = 0; r < n.length; r++)
      if (typeof n[r] != "string")
        return !1;
  }
  return !0;
}
new TextDecoder("utf-8");
var ao = new TextEncoder(), uo = class {
  generateSecretKey() {
    return G.utils.randomSecretKey();
  }
  getPublicKey(e) {
    return q(G.getPublicKey(e));
  }
  finalizeEvent(e, n) {
    const r = e;
    return r.pubkey = q(G.getPublicKey(n)), r.id = ct(r), r.sig = q(G.sign(P(ct(r)), n)), r[Ee] = !0, r;
  }
  verifyEvent(e) {
    if (typeof e[Ee] == "boolean")
      return e[Ee];
    try {
      const n = ct(e);
      if (n !== e.id)
        return e[Ee] = !1, !1;
      const r = G.verify(P(e.sig), P(n), P(e.pubkey));
      return e[Ee] = r, r;
    } catch {
      return e[Ee] = !1, !1;
    }
  }
};
function fo(t) {
  if (!co(t))
    throw new Error("can't serialize event with wrong or missing properties");
  return JSON.stringify([0, t.pubkey, t.created_at, t.kind, t.tags, t.content]);
}
function ct(t) {
  let e = ae(ao.encode(fo(t)));
  return q(e);
}
var Ge = new uo();
Ge.generateSecretKey;
Ge.getPublicKey;
Ge.finalizeEvent;
var fi = Ge.verifyEvent;
/*! scure-base - MIT License (c) 2022 Paul Miller (paulmillr.com) */
function _t(t) {
  return t instanceof Uint8Array || ArrayBuffer.isView(t) && t.constructor.name === "Uint8Array";
}
function lo(t) {
  if (!_t(t))
    throw new Error("Uint8Array expected");
}
function kn(t, e) {
  return Array.isArray(e) ? e.length === 0 ? !0 : t ? e.every((n) => typeof n == "string") : e.every((n) => Number.isSafeInteger(n)) : !1;
}
function ho(t) {
  if (typeof t != "function")
    throw new Error("function expected");
  return !0;
}
function be(t, e) {
  if (typeof e != "string")
    throw new Error(`${t}: string expected`);
  return !0;
}
function Tt(t) {
  if (!Number.isSafeInteger(t))
    throw new Error(`invalid integer: ${t}`);
}
function yt(t) {
  if (!Array.isArray(t))
    throw new Error("array expected");
}
function ze(t, e) {
  if (!kn(!0, e))
    throw new Error(`${t}: array of strings expected`);
}
function In(t, e) {
  if (!kn(!1, e))
    throw new Error(`${t}: array of numbers expected`);
}
// @__NO_SIDE_EFFECTS__
function Ln(...t) {
  const e = (i) => i, n = (i, s) => (a) => i(s(a)), r = t.map((i) => i.encode).reduceRight(n, e), o = t.map((i) => i.decode).reduce(n, e);
  return { encode: r, decode: o };
}
// @__NO_SIDE_EFFECTS__
function $n(t) {
  const e = typeof t == "string" ? t.split("") : t, n = e.length;
  ze("alphabet", e);
  const r = new Map(e.map((o, i) => [o, i]));
  return {
    encode: (o) => (yt(o), o.map((i) => {
      if (!Number.isSafeInteger(i) || i < 0 || i >= n)
        throw new Error(`alphabet.encode: digit index outside alphabet "${i}". Allowed: ${t}`);
      return e[i];
    })),
    decode: (o) => (yt(o), o.map((i) => {
      be("alphabet.decode", i);
      const s = r.get(i);
      if (s === void 0)
        throw new Error(`Unknown letter: "${i}". Allowed: ${t}`);
      return s;
    }))
  };
}
// @__NO_SIDE_EFFECTS__
function Hn(t = "") {
  return be("join", t), {
    encode: (e) => (ze("join.decode", e), e.join(t)),
    decode: (e) => (be("join.decode", e), e.split(t))
  };
}
// @__NO_SIDE_EFFECTS__
function go(t, e = "=") {
  return Tt(t), be("padding", e), {
    encode(n) {
      for (ze("padding.encode", n); n.length * t % 8; )
        n.push(e);
      return n;
    },
    decode(n) {
      ze("padding.decode", n);
      let r = n.length;
      if (r * t % 8)
        throw new Error("padding: invalid, string should have whole number of bytes");
      for (; r > 0 && n[r - 1] === e; r--)
        if ((r - 1) * t % 8 === 0)
          throw new Error("padding: invalid, string has too much padding");
      return n.slice(0, r);
    }
  };
}
const Nn = (t, e) => e === 0 ? t : Nn(e, t % e), Ze = /* @__NO_SIDE_EFFECTS__ */ (t, e) => t + (e - Nn(t, e)), Ue = /* @__PURE__ */ (() => {
  let t = [];
  for (let e = 0; e < 40; e++)
    t.push(2 ** e);
  return t;
})();
function wt(t, e, n, r) {
  if (yt(t), e <= 0 || e > 32)
    throw new Error(`convertRadix2: wrong from=${e}`);
  if (n <= 0 || n > 32)
    throw new Error(`convertRadix2: wrong to=${n}`);
  if (/* @__PURE__ */ Ze(e, n) > 32)
    throw new Error(`convertRadix2: carry overflow from=${e} to=${n} carryBits=${/* @__PURE__ */ Ze(e, n)}`);
  let o = 0, i = 0;
  const s = Ue[e], a = Ue[n] - 1, c = [];
  for (const u of t) {
    if (Tt(u), u >= s)
      throw new Error(`convertRadix2: invalid data word=${u} from=${e}`);
    if (o = o << e | u, i + e > 32)
      throw new Error(`convertRadix2: carry overflow pos=${i} from=${e}`);
    for (i += e; i >= n; i -= n)
      c.push((o >> i - n & a) >>> 0);
    const g = Ue[i];
    if (g === void 0)
      throw new Error("invalid carry");
    o &= g - 1;
  }
  if (o = o << n - i & a, !r && i >= e)
    throw new Error("Excess padding");
  if (!r && o > 0)
    throw new Error(`Non-zero padding: ${o}`);
  return r && i > 0 && c.push(o >>> 0), c;
}
// @__NO_SIDE_EFFECTS__
function Un(t, e = !1) {
  if (Tt(t), t <= 0 || t > 32)
    throw new Error("radix2: bits should be in (0..32]");
  if (/* @__PURE__ */ Ze(8, t) > 32 || /* @__PURE__ */ Ze(t, 8) > 32)
    throw new Error("radix2: carry overflow");
  return {
    encode: (n) => {
      if (!_t(n))
        throw new Error("radix2.encode input should be Uint8Array");
      return wt(Array.from(n), 8, t, !e);
    },
    decode: (n) => (In("radix2.decode", n), Uint8Array.from(wt(n, t, 8, e)))
  };
}
function Wt(t) {
  return ho(t), function(...e) {
    try {
      return t.apply(null, e);
    } catch {
    }
  };
}
const yo = typeof Uint8Array.from([]).toBase64 == "function" && typeof Uint8Array.fromBase64 == "function", wo = (t, e) => {
  be("base64", t);
  const n = /^[A-Za-z0-9=+/]+$/, r = "base64";
  if (t.length > 0 && !n.test(t))
    throw new Error("invalid base64");
  return Uint8Array.fromBase64(t, { alphabet: r, lastChunkHandling: "strict" });
}, Cn = yo ? {
  encode(t) {
    return lo(t), t.toBase64();
  },
  decode(t) {
    return wo(t);
  }
} : /* @__PURE__ */ Ln(/* @__PURE__ */ Un(6), /* @__PURE__ */ $n("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"), /* @__PURE__ */ go(6), /* @__PURE__ */ Hn("")), bt = /* @__PURE__ */ Ln(/* @__PURE__ */ $n("qpzry9x8gf2tvdw0s3jn54khce6mua7l"), /* @__PURE__ */ Hn("")), jt = [996825010, 642813549, 513874426, 1027748829, 705979059];
function Se(t) {
  const e = t >> 25;
  let n = (t & 33554431) << 5;
  for (let r = 0; r < jt.length; r++)
    (e >> r & 1) === 1 && (n ^= jt[r]);
  return n;
}
function Ft(t, e, n = 1) {
  const r = t.length;
  let o = 1;
  for (let i = 0; i < r; i++) {
    const s = t.charCodeAt(i);
    if (s < 33 || s > 126)
      throw new Error(`Invalid prefix (${t})`);
    o = Se(o) ^ s >> 5;
  }
  o = Se(o);
  for (let i = 0; i < r; i++)
    o = Se(o) ^ t.charCodeAt(i) & 31;
  for (let i of e)
    o = Se(o) ^ i;
  for (let i = 0; i < 6; i++)
    o = Se(o);
  return o ^= n, bt.encode(wt([o % Ue[30]], 30, 5, !1));
}
// @__NO_SIDE_EFFECTS__
function bo(t) {
  const e = t === "bech32" ? 1 : 734539939, n = /* @__PURE__ */ Un(5), r = n.decode, o = n.encode, i = Wt(r);
  function s(f, w, y = 90) {
    be("bech32.encode prefix", f), _t(w) && (w = Array.from(w)), In("bech32.encode", w);
    const b = f.length;
    if (b === 0)
      throw new TypeError(`Invalid prefix length ${b}`);
    const x = b + 7 + w.length;
    if (y !== !1 && x > y)
      throw new TypeError(`Length ${x} exceeds limit ${y}`);
    const A = f.toLowerCase(), O = Ft(A, w, e);
    return `${A}1${bt.encode(w)}${O}`;
  }
  function a(f, w = 90) {
    be("bech32.decode input", f);
    const y = f.length;
    if (y < 8 || w !== !1 && y > w)
      throw new TypeError(`invalid string length: ${y} (${f}). Expected (8..${w})`);
    const b = f.toLowerCase();
    if (f !== b && f !== f.toUpperCase())
      throw new Error("String must be lowercase or uppercase");
    const x = b.lastIndexOf("1");
    if (x === 0 || x === -1)
      throw new Error('Letter "1" must be present between prefix and data only');
    const A = b.slice(0, x), O = b.slice(x + 1);
    if (O.length < 6)
      throw new Error("Data must be at least 6 characters long");
    const $ = bt.decode(O).slice(0, -6), z = Ft(A, $, e);
    if (!O.endsWith(z))
      throw new Error(`Invalid checksum in ${f}: expected "${z}"`);
    return { prefix: A, words: $ };
  }
  const c = Wt(a);
  function u(f) {
    const { prefix: w, words: y } = a(f, !1);
    return { prefix: w, words: y, bytes: r(y) };
  }
  function g(f, w) {
    return s(f, o(w));
  }
  return {
    encode: s,
    decode: a,
    encodeFromBytes: g,
    decodeToBytes: u,
    decodeUnsafe: c,
    fromWords: r,
    fromWordsUnsafe: i,
    toWords: o
  };
}
const Ke = /* @__PURE__ */ bo("bech32");
var $e = new TextDecoder("utf-8"), We = new TextEncoder(), po = {
  isNProfile: (t) => /^nprofile1[a-z\d]+$/.test(t || ""),
  isNEvent: (t) => /^nevent1[a-z\d]+$/.test(t || ""),
  isNAddr: (t) => /^naddr1[a-z\d]+$/.test(t || ""),
  isNSec: (t) => /^nsec1[a-z\d]{58}$/.test(t || ""),
  isNPub: (t) => /^npub1[a-z\d]{58}$/.test(t || ""),
  isNote: (t) => /^note1[a-z\d]+$/.test(t || ""),
  isNcryptsec: (t) => /^ncryptsec1[a-z\d]+$/.test(t || "")
}, kt = 5e3, Eo = /[\x21-\x7E]{1,83}1[023456789acdefghjklmnpqrstuvwxyz]{6,}/;
function mo(t) {
  const e = new Uint8Array(4);
  return e[0] = t >> 24 & 255, e[1] = t >> 16 & 255, e[2] = t >> 8 & 255, e[3] = t & 255, e;
}
function vo(t) {
  try {
    return t.startsWith("nostr:") && (t = t.substring(6)), qn(t);
  } catch {
    return { type: "invalid", data: null };
  }
}
function qn(t) {
  var o, i, s, a, c, u, g;
  let { prefix: e, words: n } = Ke.decode(t, kt), r = new Uint8Array(Ke.fromWords(n));
  switch (e) {
    case "nprofile": {
      let f = at(r);
      if (!((o = f[0]) != null && o[0]))
        throw new Error("missing TLV 0 for nprofile");
      if (f[0][0].length !== 32)
        throw new Error("TLV 0 should be 32 bytes");
      return {
        type: "nprofile",
        data: {
          pubkey: q(f[0][0]),
          relays: f[1] ? f[1].map((w) => $e.decode(w)) : []
        }
      };
    }
    case "nevent": {
      let f = at(r);
      if (!((i = f[0]) != null && i[0]))
        throw new Error("missing TLV 0 for nevent");
      if (f[0][0].length !== 32)
        throw new Error("TLV 0 should be 32 bytes");
      if (f[2] && f[2][0].length !== 32)
        throw new Error("TLV 2 should be 32 bytes");
      if (f[3] && f[3][0].length !== 4)
        throw new Error("TLV 3 should be 4 bytes");
      return {
        type: "nevent",
        data: {
          id: q(f[0][0]),
          relays: f[1] ? f[1].map((w) => $e.decode(w)) : [],
          author: (s = f[2]) != null && s[0] ? q(f[2][0]) : void 0,
          kind: (a = f[3]) != null && a[0] ? parseInt(q(f[3][0]), 16) : void 0
        }
      };
    }
    case "naddr": {
      let f = at(r);
      if (!((c = f[0]) != null && c[0]))
        throw new Error("missing TLV 0 for naddr");
      if (!((u = f[2]) != null && u[0]))
        throw new Error("missing TLV 2 for naddr");
      if (f[2][0].length !== 32)
        throw new Error("TLV 2 should be 32 bytes");
      if (!((g = f[3]) != null && g[0]))
        throw new Error("missing TLV 3 for naddr");
      if (f[3][0].length !== 4)
        throw new Error("TLV 3 should be 4 bytes");
      return {
        type: "naddr",
        data: {
          identifier: $e.decode(f[0][0]),
          pubkey: q(f[2][0]),
          kind: parseInt(q(f[3][0]), 16),
          relays: f[1] ? f[1].map((w) => $e.decode(w)) : []
        }
      };
    }
    case "nsec":
      return { type: e, data: r };
    case "npub":
    case "note":
      return { type: e, data: q(r) };
    default:
      throw new Error(`unknown prefix ${e}`);
  }
}
function at(t) {
  let e = {}, n = t;
  for (; n.length > 0; ) {
    let r = n[0], o = n[1], i = n.slice(2, 2 + o);
    if (n = n.slice(2 + o), i.length < o)
      throw new Error(`not enough data to read on TLV ${r}`);
    e[r] = e[r] || [], e[r].push(i);
  }
  return e;
}
function xo(t) {
  return Qe("nsec", t);
}
function So(t) {
  return Qe("npub", P(t));
}
function Bo(t) {
  return Qe("note", P(t));
}
function Je(t, e) {
  let n = Ke.toWords(e);
  return Ke.encode(t, n, kt);
}
function Qe(t, e) {
  return Je(t, e);
}
function Ao(t) {
  let e = It({
    0: [P(t.pubkey)],
    1: (t.relays || []).map((n) => We.encode(n))
  });
  return Je("nprofile", e);
}
function Ro(t) {
  let e;
  t.kind !== void 0 && (e = mo(t.kind));
  let n = It({
    0: [P(t.id)],
    1: (t.relays || []).map((r) => We.encode(r)),
    2: t.author ? [P(t.author)] : [],
    3: e ? [new Uint8Array(e)] : []
  });
  return Je("nevent", n);
}
function Oo(t) {
  let e = new ArrayBuffer(4);
  new DataView(e).setUint32(0, t.kind, !1);
  let n = It({
    0: [We.encode(t.identifier)],
    1: (t.relays || []).map((r) => We.encode(r)),
    2: [P(t.pubkey)],
    3: [new Uint8Array(e)]
  });
  return Je("naddr", n);
}
function It(t) {
  let e = [];
  return Object.entries(t).reverse().forEach(([n, r]) => {
    r.forEach((o) => {
      let i = new Uint8Array(o.length + 2);
      i.set([parseInt(n)], 0), i.set([o.length], 1), i.set(o, 2), e.push(i);
    });
  }), ee(...e);
}
const li = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  BECH32_REGEX: Eo,
  Bech32MaxSize: kt,
  NostrTypeGuard: po,
  decode: qn,
  decodeNostrURI: vo,
  encodeBytes: Qe,
  naddrEncode: Oo,
  neventEncode: Ro,
  noteEncode: Bo,
  nprofileEncode: Ao,
  npubEncode: So,
  nsecEncode: xo
}, Symbol.toStringTag, { value: "Module" }));
/*! noble-ciphers - MIT License (c) 2023 Paul Miller (paulmillr.com) */
function _o(t) {
  return t instanceof Uint8Array || ArrayBuffer.isView(t) && t.constructor.name === "Uint8Array";
}
function Yt(t) {
  if (typeof t != "boolean")
    throw new Error(`boolean expected, not ${t}`);
}
function ut(t) {
  if (!Number.isSafeInteger(t) || t < 0)
    throw new Error("positive integer expected, got " + t);
}
function Be(t, e, n = "") {
  const r = _o(t), o = t == null ? void 0 : t.length, i = e !== void 0;
  if (!r || i && o !== e) {
    const s = n && `"${n}" `, a = i ? ` of length ${e}` : "", c = r ? `length=${o}` : `type=${typeof t}`;
    throw new Error(s + "expected Uint8Array" + a + ", got " + c);
  }
  return t;
}
function de(t) {
  return new Uint32Array(t.buffer, t.byteOffset, Math.floor(t.byteLength / 4));
}
function To(...t) {
  for (let e = 0; e < t.length; e++)
    t[e].fill(0);
}
function ko(t, e) {
  if (e == null || typeof e != "object")
    throw new Error("options must be defined");
  return Object.assign(t, e);
}
function Io(t, e) {
  if (t.length !== e.length)
    return !1;
  let n = 0;
  for (let r = 0; r < t.length; r++)
    n |= t[r] ^ e[r];
  return n === 0;
}
function Xt(t) {
  return Uint8Array.from(t);
}
const Pn = (t) => Uint8Array.from(t.split(""), (e) => e.charCodeAt(0)), Lo = Pn("expand 16-byte k"), $o = Pn("expand 32-byte k"), Ho = de(Lo), No = de($o);
function L(t, e) {
  return t << e | t >>> 32 - e;
}
function pt(t) {
  return t.byteOffset % 4 === 0;
}
const He = 64, Uo = 16, Dn = 2 ** 32 - 1, Gt = Uint32Array.of();
function Co(t, e, n, r, o, i, s, a) {
  const c = o.length, u = new Uint8Array(He), g = de(u), f = pt(o) && pt(i), w = f ? de(o) : Gt, y = f ? de(i) : Gt;
  for (let b = 0; b < c; s++) {
    if (t(e, n, r, g, s, a), s >= Dn)
      throw new Error("arx: counter overflow");
    const x = Math.min(He, c - b);
    if (f && x === He) {
      const A = b / 4;
      if (b % 4 !== 0)
        throw new Error("arx: invalid block position");
      for (let O = 0, $; O < Uo; O++)
        $ = A + O, y[$] = w[$] ^ g[O];
      b += He;
      continue;
    }
    for (let A = 0, O; A < x; A++)
      O = b + A, i[O] = o[O] ^ u[A];
    b += x;
  }
}
function qo(t, e) {
  const { allowShortKeys: n, extendNonceFn: r, counterLength: o, counterRight: i, rounds: s } = ko({ allowShortKeys: !1, counterLength: 8, counterRight: !1, rounds: 20 }, e);
  if (typeof t != "function")
    throw new Error("core must be a function");
  return ut(o), ut(s), Yt(i), Yt(n), (a, c, u, g, f = 0) => {
    Be(a, void 0, "key"), Be(c, void 0, "nonce"), Be(u, void 0, "data");
    const w = u.length;
    if (g === void 0 && (g = new Uint8Array(w)), Be(g, void 0, "output"), ut(f), f < 0 || f >= Dn)
      throw new Error("arx: counter overflow");
    if (g.length < w)
      throw new Error(`arx: output (${g.length}) is shorter than data (${w})`);
    const y = [];
    let b = a.length, x, A;
    if (b === 32)
      y.push(x = Xt(a)), A = No;
    else if (b === 16 && n)
      x = new Uint8Array(32), x.set(a), x.set(a, 16), A = Ho, y.push(x);
    else
      throw Be(a, 32, "arx key"), new Error("invalid key size");
    pt(c) || y.push(c = Xt(c));
    const O = de(x);
    if (r) {
      if (c.length !== 24)
        throw new Error("arx: extended nonce must be 24 bytes");
      r(A, O, de(c.subarray(0, 16)), O), c = c.subarray(16);
    }
    const $ = 16 - o;
    if ($ !== c.length)
      throw new Error(`arx: nonce must be ${$} or 16 bytes`);
    if ($ !== 12) {
      const H = new Uint8Array(12);
      H.set(c, i ? 0 : 12 - c.length), c = H, y.push(c);
    }
    const z = de(c);
    return Co(t, A, O, z, u, g, f, s), To(...y), g;
  };
}
function Po(t, e, n, r, o, i = 20) {
  let s = t[0], a = t[1], c = t[2], u = t[3], g = e[0], f = e[1], w = e[2], y = e[3], b = e[4], x = e[5], A = e[6], O = e[7], $ = o, z = n[0], H = n[1], Q = n[2], D = s, j = a, Z = c, U = u, K = g, V = f, T = w, _ = y, d = b, l = x, p = A, m = O, B = $, v = z, R = H, E = Q;
  for (let k = 0; k < i; k += 2)
    D = D + K | 0, B = L(B ^ D, 16), d = d + B | 0, K = L(K ^ d, 12), D = D + K | 0, B = L(B ^ D, 8), d = d + B | 0, K = L(K ^ d, 7), j = j + V | 0, v = L(v ^ j, 16), l = l + v | 0, V = L(V ^ l, 12), j = j + V | 0, v = L(v ^ j, 8), l = l + v | 0, V = L(V ^ l, 7), Z = Z + T | 0, R = L(R ^ Z, 16), p = p + R | 0, T = L(T ^ p, 12), Z = Z + T | 0, R = L(R ^ Z, 8), p = p + R | 0, T = L(T ^ p, 7), U = U + _ | 0, E = L(E ^ U, 16), m = m + E | 0, _ = L(_ ^ m, 12), U = U + _ | 0, E = L(E ^ U, 8), m = m + E | 0, _ = L(_ ^ m, 7), D = D + V | 0, E = L(E ^ D, 16), p = p + E | 0, V = L(V ^ p, 12), D = D + V | 0, E = L(E ^ D, 8), p = p + E | 0, V = L(V ^ p, 7), j = j + T | 0, B = L(B ^ j, 16), m = m + B | 0, T = L(T ^ m, 12), j = j + T | 0, B = L(B ^ j, 8), m = m + B | 0, T = L(T ^ m, 7), Z = Z + _ | 0, v = L(v ^ Z, 16), d = d + v | 0, _ = L(_ ^ d, 12), Z = Z + _ | 0, v = L(v ^ Z, 8), d = d + v | 0, _ = L(_ ^ d, 7), U = U + K | 0, R = L(R ^ U, 16), l = l + R | 0, K = L(K ^ l, 12), U = U + K | 0, R = L(R ^ U, 8), l = l + R | 0, K = L(K ^ l, 7);
  let S = 0;
  r[S++] = s + D | 0, r[S++] = a + j | 0, r[S++] = c + Z | 0, r[S++] = u + U | 0, r[S++] = g + K | 0, r[S++] = f + V | 0, r[S++] = w + T | 0, r[S++] = y + _ | 0, r[S++] = b + d | 0, r[S++] = x + l | 0, r[S++] = A + p | 0, r[S++] = O + m | 0, r[S++] = $ + B | 0, r[S++] = z + v | 0, r[S++] = H + R | 0, r[S++] = Q + E | 0;
}
const Vn = /* @__PURE__ */ qo(Po, {
  counterRight: !1,
  counterLength: 4,
  allowShortKeys: !1
});
function Do(t, e, n) {
  return je(t), n === void 0 && (n = new Uint8Array(t.outputLen)), ke(t, n, e);
}
const ft = /* @__PURE__ */ Uint8Array.of(0), Jt = /* @__PURE__ */ Uint8Array.of();
function Vo(t, e, n, r = 32) {
  je(t), he(r, "length");
  const o = t.outputLen;
  if (r > 255 * o)
    throw new Error("Length must be <= 255*HashLen");
  const i = Math.ceil(r / o);
  n === void 0 ? n = Jt : N(n, void 0, "info");
  const s = new Uint8Array(i * o), a = ke.create(t, e), c = a._cloneInto(), u = new Uint8Array(a.outputLen);
  for (let g = 0; g < i; g++)
    ft[0] = g + 1, c.update(g === 0 ? Jt : u).update(n).update(ft).digestInto(u), s.set(u, o * g), a._cloneInto(c);
  return a.destroy(), c.destroy(), Oe(u, ft), s.slice(0, r);
}
var Mo = new TextDecoder("utf-8"), Lt = new TextEncoder(), Mn = 1, zn = 65535;
function zo(t, e) {
  const n = zr.getSharedSecret(t, P("02" + e)).subarray(1, 33);
  return Do(ae, n, Lt.encode("nip44-v2"));
}
function Zn(t, e) {
  const n = Vo(ae, t, e, 76);
  return {
    chacha_key: n.subarray(0, 32),
    chacha_nonce: n.subarray(32, 44),
    hmac_key: n.subarray(44, 76)
  };
}
function Kn(t) {
  if (!Number.isSafeInteger(t) || t < 1)
    throw new Error("expected positive integer");
  if (t <= 32)
    return 32;
  const e = 1 << Math.floor(Math.log2(t - 1)) + 1, n = e <= 256 ? 32 : e / 8;
  return n * (Math.floor((t - 1) / n) + 1);
}
function Zo(t) {
  if (!Number.isSafeInteger(t) || t < Mn || t > zn)
    throw new Error("invalid plaintext size: must be between 1 and 65535 bytes");
  const e = new Uint8Array(2);
  return new DataView(e.buffer).setUint16(0, t, !1), e;
}
function Ko(t) {
  const e = Lt.encode(t), n = e.length, r = Zo(n), o = new Uint8Array(Kn(n) - n);
  return ee(r, e, o);
}
function Wo(t) {
  const e = new DataView(t.buffer).getUint16(0), n = t.subarray(2, 2 + e);
  if (e < Mn || e > zn || n.length !== e || t.length !== 2 + Kn(e))
    throw new Error("invalid padding");
  return Mo.decode(n);
}
function Wn(t, e, n) {
  if (n.length !== 32)
    throw new Error("AAD associated data must be 32 bytes");
  const r = ee(n, e);
  return ke(ae, t, r);
}
function jo(t) {
  if (typeof t != "string")
    throw new Error("payload must be a valid string");
  const e = t.length;
  if (e < 132 || e > 87472)
    throw new Error("invalid payload length: " + e);
  if (t[0] === "#")
    throw new Error("unknown encryption version");
  let n;
  try {
    n = Cn.decode(t);
  } catch (i) {
    throw new Error("invalid base64: " + i.message);
  }
  const r = n.length;
  if (r < 99 || r > 65603)
    throw new Error("invalid data length: " + r);
  const o = n[0];
  if (o !== 2)
    throw new Error("unknown encryption version " + o);
  return {
    nonce: n.subarray(1, 33),
    ciphertext: n.subarray(33, -32),
    mac: n.subarray(-32)
  };
}
function Fo(t, e, n = _e(32)) {
  const { chacha_key: r, chacha_nonce: o, hmac_key: i } = Zn(e, n), s = Ko(t), a = Vn(r, o, s), c = Wn(i, a, n);
  return Cn.encode(ee(new Uint8Array([2]), n, a, c));
}
function Yo(t, e) {
  const { nonce: n, ciphertext: r, mac: o } = jo(t), { chacha_key: i, chacha_nonce: s, hmac_key: a } = Zn(e, n), c = Wn(a, r, n);
  if (!Io(c, o))
    throw new Error("invalid MAC");
  const u = Vn(i, s, r);
  return Wo(u);
}
var me = Symbol("verified"), Xo = (t) => t instanceof Object;
function Go(t) {
  if (!Xo(t) || typeof t.kind != "number" || typeof t.content != "string" || typeof t.created_at != "number" || typeof t.pubkey != "string" || !t.pubkey.match(/^[a-f0-9]{64}$/) || !Array.isArray(t.tags))
    return !1;
  for (let e = 0; e < t.tags.length; e++) {
    let n = t.tags[e];
    if (!Array.isArray(n))
      return !1;
    for (let r = 0; r < n.length; r++)
      if (typeof n[r] != "string")
        return !1;
  }
  return !0;
}
var Jo = class {
  generateSecretKey() {
    return G.utils.randomSecretKey();
  }
  getPublicKey(t) {
    return q(G.getPublicKey(t));
  }
  finalizeEvent(t, e) {
    const n = t;
    return n.pubkey = q(G.getPublicKey(e)), n.id = Ce(n), n.sig = q(G.sign(P(Ce(n)), e)), n[me] = !0, n;
  }
  verifyEvent(t) {
    if (typeof t[me] == "boolean")
      return t[me];
    try {
      const e = Ce(t);
      if (e !== t.id)
        return t[me] = !1, !1;
      const n = G.verify(P(t.sig), P(e), P(t.pubkey));
      return t[me] = n, n;
    } catch {
      return t[me] = !1, !1;
    }
  }
};
function Qo(t) {
  if (!Go(t))
    throw new Error("can't serialize event with wrong or missing properties");
  return JSON.stringify([0, t.pubkey, t.created_at, t.kind, t.tags, t.content]);
}
function Ce(t) {
  let e = ae(Lt.encode(Qo(t)));
  return q(e);
}
var et = new Jo(), ei = et.generateSecretKey, jn = et.getPublicKey, Fn = et.finalizeEvent;
et.verifyEvent;
var ti = 13, ni = 1059, ri = 2 * 24 * 60 * 60, Yn = () => Math.round(Date.now() / 1e3), Xn = () => Math.round(Yn() - Math.random() * ri), Gn = (t, e) => zo(t, e), Jn = (t, e, n) => Fo(JSON.stringify(t), Gn(e, n)), Qt = (t, e) => JSON.parse(Yo(t.content, Gn(e, t.pubkey)));
function Qn(t, e) {
  const n = {
    created_at: Yn(),
    content: "",
    tags: [],
    ...t,
    pubkey: jn(e)
  };
  return n.id = Ce(n), n;
}
function er(t, e, n) {
  return Fn(
    {
      kind: ti,
      content: Jn(t, e, n),
      created_at: Xn(),
      tags: []
    },
    e
  );
}
function tr(t, e) {
  const n = ei();
  return Fn(
    {
      kind: ni,
      content: Jn(t, n, e),
      created_at: Xn(),
      tags: [["p", e]]
    },
    n
  );
}
function Et(t, e, n) {
  const r = Qn(t, e), o = er(r, e, n);
  return tr(o, n);
}
function oi(t, e, n) {
  if (!n || n.length === 0)
    throw new Error("At least one recipient is required.");
  const r = jn(e), o = [Et(t, e, r)];
  return n.forEach((i) => {
    o.push(Et(t, e, i));
  }), o;
}
function nr(t, e) {
  const n = Qt(t, e);
  return Qt(n, e);
}
function ii(t, e) {
  let n = [];
  return t.forEach((r) => {
    n.push(nr(r, e));
  }), n.sort((r, o) => r.created_at - o.created_at), n;
}
const di = /* @__PURE__ */ Object.freeze(/* @__PURE__ */ Object.defineProperty({
  __proto__: null,
  createRumor: Qn,
  createSeal: er,
  createWrap: tr,
  unwrapEvent: nr,
  unwrapManyEvents: ii,
  wrapEvent: Et,
  wrapManyEvents: oi
}, Symbol.toStringTag, { value: "Module" }));
export {
  ai as SimplePool,
  ct as getEventHash,
  li as nip19,
  di as nip59,
  fi as verifyEvent
};
