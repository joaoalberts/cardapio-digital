// Bandeiras desenhadas em SVG para ficarem iguais em todo celular
// (emoji de bandeira não aparece no Windows e varia entre Android e iOS).
export function Flag({ code }: { code: string }) {
  let body: React.ReactNode;
  if (code === "br") {
    body = (
      <>
        <rect width="30" height="20" fill="#229e45" />
        <path d="M15 2.4 27.4 10 15 17.6 2.6 10z" fill="#f8e509" />
        <circle cx="15" cy="10" r="4.7" fill="#2b49a3" />
        <path d="M10.5 9.1c3-.9 6.4-.4 9 1.5" stroke="#fff" strokeWidth=".9" fill="none" />
      </>
    );
  } else if (code === "us") {
    body = (
      <>
        <rect width="30" height="20" fill="#fff" />
        {[0, 2, 4, 6, 8, 10, 12].map((i) => (
          <rect key={i} y={((i * 20) / 13).toFixed(2)} width="30" height={(20 / 13).toFixed(2)} fill="#b22234" />
        ))}
        <rect width="13" height="10.77" fill="#3c3b6e" />
        {[0, 1, 2, 3].flatMap((r) =>
          [0, 1, 2, 3, 4].map((c) => (
            <circle key={`${r}-${c}`} cx={1.6 + c * 2.45} cy={1.6 + r * 2.5} r=".55" fill="#fff" />
          )),
        )}
      </>
    );
  } else if (code === "es") {
    body = (
      <>
        <rect width="30" height="20" fill="#c60b1e" />
        <rect y="5" width="30" height="10" fill="#ffc400" />
      </>
    );
  } else if (code === "fr" || code === "it") {
    const [a, c] = code === "fr" ? ["#0055a4", "#ef4135"] : ["#009246", "#ce2b37"];
    body = (
      <>
        <rect width="10" height="20" fill={a} />
        <rect x="10" width="10" height="20" fill="#fff" />
        <rect x="20" width="10" height="20" fill={c} />
      </>
    );
  } else if (code === "de") {
    body = (
      <>
        <rect width="30" height="6.7" fill="#000" />
        <rect y="6.6" width="30" height="6.8" fill="#dd0000" />
        <rect y="13.3" width="30" height="6.7" fill="#ffce00" />
      </>
    );
  } else {
    // Idioma sem bandeira conhecida: globo.
    body = (
      <>
        <rect width="30" height="20" fill="#3a3a3a" />
        <circle cx="15" cy="10" r="6" stroke="#fff" strokeWidth="1.2" fill="none" />
        <path d="M9 10h12M15 4c2 2 2 10 0 12M15 4c-2 2-2 10 0 12" stroke="#fff" strokeWidth="1" fill="none" />
      </>
    );
  }
  return (
    <svg viewBox="0 0 30 20" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      {body}
    </svg>
  );
}
