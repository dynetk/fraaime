export default function Brand() {
  return (
    <a className="brand-link" href="/" aria-label="Fraaime home">
      {/* Original outlined artwork extracted from the supplied brand guide. */}
      <img
        className="brand-lockup"
        src="/brand/fraaime-lockup.svg"
        alt=""
        width="485"
        height="70"
      />
      <img
        className="brand-symbol"
        src="/brand/fraaime-symbol.svg"
        alt=""
        width="124"
        height="70"
      />
    </a>
  );
}
