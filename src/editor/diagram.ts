// The geometry diagram follows the vertical alignment and highlights the
// measurement for whichever field has focus.

export function bindGeometryDiagram(svg: SVGSVGElement, form: HTMLFormElement): (alignment: number) => void {
  const highlight = (name: string | null) => {
    for (const el of svg.querySelectorAll<SVGElement>('[data-dim]')) {
      el.classList.toggle('active', el.dataset.dim === name);
    }
  };
  form.addEventListener('focusin', (e) => highlight((e.target as HTMLInputElement).name ?? null));
  form.addEventListener('focusout', () => highlight(null));
  return (alignment) => {
    svg.dataset.align = String(alignment);
  };
}
