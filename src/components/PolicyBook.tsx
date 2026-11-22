import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getToken } from "../api.js";
import { Card, Notice, Spinner } from "./ui.js";

/**
 * The Policy Book, drawn as a page-turning book. The server hands over the PDF; the pages are
 * painted to images here, so there is no PDF viewer, toolbar or download button on screen.
 * (A page image can always be screenshotted — this keeps casual saving and printing out of reach.)
 */
export default function PolicyBook() {
  const [pages, setPages] = useState<string[]>([]);
  const [ratio, setRatio] = useState(1.414);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [flipped, setFlipped] = useState(0); // how many leaves have been turned
  const [width, setWidth] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let dead = false;
    (async () => {
      try {
        const res = await fetch("/api/policy-book", { headers: { Authorization: `Bearer ${getToken()}` } });
        if (!res.ok) {
          const msg = await res.json().then((b) => b.error).catch(() => "");
          throw new Error(msg || "The Policy Book could not be opened.");
        }
        const data = new Uint8Array(await res.arrayBuffer());
        const pdfjs = await import("pdfjs-dist");
        const worker = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
        pdfjs.GlobalWorkerOptions.workerSrc = worker;
        const doc = await pdfjs.getDocument({ data }).promise;
        const out: string[] = [];
        for (let n = 1; n <= doc.numPages; n++) {
          const page = await doc.getPage(n);
          const base = page.getViewport({ scale: 1 });
          if (n === 1) setRatio(base.height / base.width);
          const viewport = page.getViewport({ scale: 900 / base.width });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          await page.render({ canvasContext: canvas.getContext("2d")!, viewport, canvas }).promise;
          out.push(canvas.toDataURL("image/jpeg", 0.85));
          if (dead) return;
          if (n <= 2 || n === doc.numPages) setPages([...out]);
        }
        if (!dead) setPages(out);
      } catch (e) {
        if (!dead) setError((e as Error).message);
      } finally {
        if (!dead) setLoading(false);
      }
    })();
    return () => { dead = true; };
  }, []);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [pages.length > 0]);

  const leaves = Math.ceil(pages.length / 2);
  const go = (d: number) => setFlipped((f) => Math.max(0, Math.min(leaves, f + d)));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [leaves]);

  const pageW = Math.max(120, Math.min(520, width / 2 - 8));
  const pageH = pageW * ratio;
  // Closed, the cover sits centred; once every leaf is turned the back cover does.
  const shift = flipped === 0 ? -pageW / 2 : flipped === leaves ? pageW / 2 : 0;

  const first = flipped === 0 ? 1 : flipped * 2;
  const label = flipped === 0 ? "Cover" : `Pages ${Math.min(first, pages.length)}–${Math.min(first + 1, pages.length)} of ${pages.length}`;

  return (
    <div className="space-y-4">
      <Card title="Policy Book" subtitle="Turn the pages with the arrows, the arrow keys, or by clicking a page. For reading only.">
        {error && <Notice tone="error" items={[error]} />}
        {loading && pages.length === 0 && <Spinner />}
        {pages.length > 0 && (
          <div
            ref={box}
            className="select-none overflow-hidden py-4 print:hidden"
            onContextMenu={(e) => e.preventDefault()}
          >
            <div
              className="relative mx-auto transition-transform duration-700 ease-in-out"
              style={{ width: pageW * 2, height: pageH, perspective: 2200, transform: `translateX(${shift}px)` }}
            >
              <div className="absolute inset-y-0 left-1/2 right-0 rounded-r-md shadow-xl" style={{ background: "#fff" }} />
              {Array.from({ length: leaves }, (_, i) => {
                const turned = i < flipped;
                const front = pages[i * 2];
                const back = pages[i * 2 + 1];
                return (
                  <div
                    key={i}
                    className="absolute top-0 cursor-pointer"
                    style={{
                      left: "50%", width: pageW, height: pageH, transformOrigin: "left center",
                      transformStyle: "preserve-3d", transition: "transform 0.9s cubic-bezier(.45,.05,.25,1)",
                      transform: turned ? "rotateY(-180deg)" : "rotateY(0deg)",
                      zIndex: turned ? i : leaves - i,
                    }}
                    onClick={() => go(turned ? -1 : 1)}
                  >
                    <Face src={front} w={pageW} h={pageH} />
                    <Face src={back} w={pageW} h={pageH} back />
                  </div>
                );
              })}
            </div>
            <div className="mt-5 flex items-center justify-center gap-4">
              <button className="btn-ghost" onClick={() => go(-1)} disabled={flipped === 0} aria-label="Previous page">
                <ChevronLeft size={18} />
              </button>
              <span className="min-w-40 text-center text-sm text-slate-500">{label}</span>
              <button className="btn-ghost" onClick={() => go(1)} disabled={flipped === leaves} aria-label="Next page">
                <ChevronRight size={18} />
              </button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}

function Face({ src, w, h, back = false }: { src?: string; w: number; h: number; back?: boolean }) {
  return (
    <div
      className="absolute inset-0 overflow-hidden bg-white"
      style={{
        width: w, height: h, backfaceVisibility: "hidden",
        transform: back ? "rotateY(180deg)" : undefined,
        boxShadow: back ? "inset -10px 0 14px -10px rgba(0,0,0,.25)" : "inset 10px 0 14px -10px rgba(0,0,0,.25)",
      }}
    >
      {src && <img src={src} alt="" draggable={false} className="pointer-events-none h-full w-full object-fill" />}
    </div>
  );
}
