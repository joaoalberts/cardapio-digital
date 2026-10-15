// A foto do prato voa do botão até a ilha (~0,6 s). Com "reduzir movimento", não voa.
export function flyTo(from: HTMLElement, to: HTMLElement, src: string | null): Promise<void> {
  if (!src || matchMedia("(prefers-reduced-motion: reduce)").matches) return Promise.resolve();
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const img = document.createElement("img");
  img.className = "order-fly";
  img.src = src;
  img.alt = "";
  const x0 = a.left + a.width / 2 - 28;
  const y0 = a.top + a.height / 2 - 28;
  img.style.left = `${x0}px`;
  img.style.top = `${y0}px`;
  document.body.appendChild(img);
  const dx = b.left + b.width / 2 - 28 - x0;
  const dy = b.top + b.height / 2 - 28 - y0;
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      img.remove();
      resolve();
    };
    const anim = img.animate(
      [
        { transform: "translate(0,0) scale(1)", opacity: 1 },
        { transform: `translate(${dx * 0.35}px, ${dy * 0.55 - 40}px) scale(1.15)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(.35)`, opacity: 0.6 },
      ],
      { duration: 620, easing: "cubic-bezier(.4,0,.2,1)" },
    );
    anim.onfinish = finish;
    setTimeout(finish, 900); // aba em segundo plano pode congelar a animação
  });
}
