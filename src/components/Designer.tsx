"use client";
import { browserId } from "./browser-id";
import { useState, useEffect, useRef } from "react";
import {
  Stage,
  Layer,
  Rect,
  Text,
  Image as KImage,
  Ellipse,
  Line,
  Group,
  Transformer,
} from "react-konva";
import type Konva from "konva";
import { api } from "./client";
import { printLanguages, legacyFonts } from "../core/printing";
import {
  cardFieldCatalog,
  generalCardFields,
  cardTypes,
  type CardType,
} from "../core/card-field-catalog";
import { applyCardTheme, builtInThemes } from "../core/themes";
import {
  elementSchema,
  templateSchema,
  type Template,
  type Element,
} from "../core/template";
type Row = Record<string, any>;
const blank = (): Template => ({
  schemaVersion: 1,
  width: 85.6,
  height: 53.98,
  dpi: 300,
  background: "#ffffff",
  front: [],
  back: [],
});
function AssetImage({ element, org }: { element: Element; org: string }) {
  const [img, setImg] = useState<HTMLImageElement>();
  useEffect(() => {
    setImg(undefined);
    if (!element.assetId) return;
    const image = new window.Image();
    image.onload = () => setImg(image);
    const face =
      element.type === "photo" && element.fit === "cover" && element.faceFit;
    image.src = `/api/orgs/${org}/assets/${element.assetId}?${face ? `face=1&w=${Math.max(1, Math.min(600, Math.round(element.width * 6)))}&h=${Math.max(1, Math.min(600, Math.round(element.height * 6)))}` : "thumb=1"}`;
    return () => {
      image.onload = null;
    };
  }, [
    element.assetId,
    org,
    element.faceFit,
    element.fit,
    element.width,
    element.height,
  ]);
  const scale = img
    ? (element.fit === "contain" ? Math.min : Math.max)(
        element.width / img.naturalWidth,
        element.height / img.naturalHeight,
      )
    : 1;
  return img ? (
    <Group
      clipX={0}
      clipY={0}
      clipWidth={element.width}
      clipHeight={element.height}
    >
      <KImage
        image={img}
        x={(element.width - img.naturalWidth * scale) / 2}
        y={(element.height - img.naturalHeight * scale) / 2}
        width={img.naturalWidth * scale}
        height={img.naturalHeight * scale}
      />
    </Group>
  ) : (
    <>
      <Rect
        width={element.width}
        height={element.height}
        fill="#e5edf3"
        stroke="#adc0cd"
        dash={[1, 1]}
      />
      <Text
        text={element.type.toUpperCase()}
        fontSize={2.5}
        fill="#607c91"
        width={element.width}
        height={element.height}
        align="center"
        verticalAlign="middle"
      />
    </>
  );
}
export default function Designer({
  org,
  templateId,
  people,
  onClose,
  onError,
  themeKey,
}: {
  org: string;
  templateId?: string;
  people: Row[];
  onClose: () => void;
  onError: (s: string) => void;
  themeKey?: string;
}) {
  useEffect(() => {
    api("fonts")
      .then((c) =>
        setFontNames([
          ...new Set<string>([
            ...legacyFonts,
            ...c.fonts.map((f: { family: string }) => f.family),
          ]),
        ]),
      )
      .catch((e) => onError(e.message));
  }, []);
  const [loading, setLoading] = useState(!!templateId);
  const [loadError, setLoadError] = useState("");
  const [variants, setVariants] = useState<Template["variants"]>();
  const [doc, setDoc] = useState<Template>(blank),
    [fontNames, setFontNames] = useState<string[]>(legacyFonts),
    [name, setName] = useState("Untitled template"),
    [id, setId] = useState(templateId),
    [unit, setUnit] = useState<"mm" | "in" | "px">("mm"),
    [side, setSide] = useState<"front" | "back">("front"),
    [selection, setSelection] = useState(""),
    [zoom, setZoom] = useState(1),
    [snap, setSnap] = useState(true),
    [grid, setGrid] = useState(true),
    [busy, setBusy] = useState(false),
    [message, setMessage] = useState(""),
    [preview, setPreview] = useState(""),
    [person, setPerson] = useState(""),
    [assets, setAssets] = useState<Row[]>([]),
    [versions, setVersions] = useState<Row[]>([]),
    [restore, setRestore] = useState("");
  const [history, setHistory] = useState<Template[]>([]),
    [future, setFuture] = useState<Template[]>([]);
  useEffect(() => {
    const families = [
      ...new Set(
        [...doc.front, ...doc.back]
          .filter((e) => ["text", "date"].includes(e.type))
          .map((e) => e.fontFamily),
      ),
    ];
    let active = true;
    api("fonts")
      .then(async (catalog) => {
        for (const family of families) {
          const f = catalog.fonts.find(
            (font: { family: string }) => font.family === family,
          );
          if (
            !f ||
            Array.from(document.fonts).some((face) => face.family === family)
          )
            continue;
          try {
            const face = await new FontFace(
              family,
              `url(/api/fonts/file/${f.id})`,
            ).load();
            if (active) document.fonts.add(face);
          } catch {}
        }
        if (active) stage.current?.batchDraw();
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [
    doc.front.map((e) => e.fontFamily).join("|"),
    doc.back.map((e) => e.fontFamily).join("|"),
  ]);
  const clipboard = useRef<Element | null>(null);
  const transformer = useRef<Konva.Transformer>(null),
    stage = useRef<Konva.Stage>(null);
  useEffect(() => {
    if (!doc.cardType) return;
    let cancelled = false;
    api(`orgs/${org}/appearance`)
      .then((settings) => {
        const themes = { ...builtInThemes, ...settings.customThemes };
        const key = settings.locked
          ? settings.lockedTheme
          : themeKey || settings.defaultTheme;
        const palette = themes[key];
        if (!cancelled && palette)
          setDoc((current) =>
            applyCardTheme(current, { ...palette, ...settings.printing }, true),
          );
      })
      .catch((e) => {
        if (!cancelled) onError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [org, themeKey, doc.cardType]);
  const factor = unit === "in" ? 25.4 : unit === "px" ? 25.4 / doc.dpi : 1,
    base = `orgs/${org}/`,
    scale = 6 * zoom,
    selected = doc[side].find((e) => e.id === selection);
  useEffect(() => {
    api(base + "assets")
      .then(setAssets)
      .catch((e) => onError(e.message));
    if (templateId)
      api(base + "templates/" + templateId)
        .then((t) => {
          loadDocument(t.document);
          setName(t.name);
          setVersions(t.versions);
          setLoading(false);
        })
        .catch((e) => {
          setLoadError(e.message);
          onError(e.message);
        });
  }, [templateId, org]);
  useEffect(() => {
    const node = stage.current?.findOne("#" + selection);
    transformer.current?.nodes(node && !selected?.locked ? [node] : []);
  }, [selection, doc, side]);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  function commit(next: Template) {
    setHistory((h) => [...h.slice(-79), structuredClone(doc)]);
    setFuture([]);
    setDoc(next);
    setMessage("Unsaved changes");
  }
  function update(values: Partial<Element>) {
    if (!selected) return;
    commit({
      ...doc,
      [side]: doc[side].map((e) =>
        e.id === selection ? { ...e, ...values } : e,
      ),
    });
  }
  function undo() {
    if (!history.length) return;
    setFuture((f) => [doc, ...f]);
    setDoc(history[history.length - 1]);
    setHistory(history.slice(0, -1));
    setMessage("Unsaved changes");
  }
  function redo() {
    if (!future.length) return;
    setHistory((h) => [...h, doc]);
    setDoc(future[0]);
    setFuture(future.slice(1));
    setMessage("Unsaved changes");
  }
  function duplicate() {
    if (!selected) return;
    const copy = {
      ...selected,
      id: browserId(),
      x: selected.x + 2,
      y: selected.y + 2,
      locked: false,
    };
    commit({ ...doc, [side]: [...doc[side], copy] });
    setSelection(copy.id);
  }
  function remove() {
    if (selected && !selected.locked) {
      commit({ ...doc, [side]: doc[side].filter((e) => e.id !== selection) });
      setSelection("");
    }
  }
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).matches("input,textarea,select")) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        remove();
      }
      if (e.ctrlKey || e.metaKey) {
        if (e.key === "z") {
          e.preventDefault();
          e.shiftKey ? redo() : undo();
        }
        if (e.key === "y") {
          e.preventDefault();
          redo();
        }
        if (e.key === "c" && selected) {
          e.preventDefault();
          clipboard.current = structuredClone(selected);
        }
        if (e.key === "v" && clipboard.current) {
          e.preventDefault();
          const copy = {
            ...clipboard.current,
            id: browserId(),
            x: clipboard.current.x + 2,
            y: clipboard.current.y + 2,
            locked: false,
          };
          commit({ ...doc, [side]: [...doc[side], copy] });
          setSelection(copy.id);
        }
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });
  function add(type: Element["type"]) {
    const e = elementSchema.parse({
      id: browserId(),
      type,
      x: 5,
      y: 5,
      width: type === "qr" ? 18 : type === "text" ? 45 : 20,
      height: type === "qr" ? 18 : type === "text" ? 12 : 20,
      ...(type === "qr"
        ? { text: "{{card.verify_url}}" }
        : type === "barcode"
          ? { width: 40, height: 12, text: "{{external_id}}" }
          : type === "text"
            ? { text: "{{name}}" }
            : type === "date"
              ? { text: "{{card.date}}" }
              : type === "rect"
                ? { fill: "#0c6470" }
                : {}),
    });
    commit({ ...doc, [side]: [...doc[side], e] });
    setSelection(e.id);
  }
  async function task(fn: () => Promise<void>) {
    setBusy(true);
    onError("");
    try {
      await fn();
    } catch (e) {
      onError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function loadDocument(raw: unknown) {
    const parsed = templateSchema.parse(raw);
    setVariants(parsed.variants);
    setDoc(parsed.variants ? parsed.variants.staff : parsed);
    setSelection("");
    setHistory([]);
    setFuture([]);
    setPreview("");
  }
  function sharedDocument(): Template {
    if (!variants) return doc;
    const all = { ...variants, [doc.cardType!]: doc };
    return {
      ...all.staff,
      cardType: undefined,
      requiredFields: undefined,
      variants: all,
    };
  }
  function switchType(kind: CardType) {
    if (!variants || !doc.cardType) return;
    setVariants({ ...variants, [doc.cardType]: doc });
    setDoc(variants[kind]);
    setPerson("");
    setSelection("");
    setHistory([]);
    setFuture([]);
    setPreview("");
  }
  async function save() {
    const document = templateSchema.parse(sharedDocument());
    if (id) await api(base + "templates/" + id, "PUT", { name, document });
    else {
      const r = await api(base + "templates", "POST", { name, document });
      setId(r.id);
    }
    setMessage("Saved as a new version");
  }
  const position = (v: number) =>
    snap ? Math.round(v) : Math.round(v * 100) / 100;
  if (loading)
    return (
      <section className="panel">
        <p role="status">
          {loadError ? "Template could not be loaded." : "Loading template…"}
        </p>
        {loadError && <button onClick={onClose}>Back to Templates</button>}
      </section>
    );
  return (
    <div className="designer">
      <div className="panel designer-top">
        <button onClick={onClose}>← Templates</button>
        <input
          aria-label="Template name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <span className="muted">{message}</span>
        <button
          className="primary"
          disabled={busy}
          onClick={() => void task(save)}
        >
          Save version
        </button>
      </div>
      {variants && (
        <section className="panel">
          <label>
            Editing card type
            <select
              aria-label="Editing card type"
              value={doc.cardType}
              onChange={(e) => switchType(e.target.value as CardType)}
            >
              {Object.entries(cardTypes).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">
            All four designs belong to this one shared template. Save version
            preserves changes to every type; generation automatically selects
            the person’s card type.
          </p>
        </section>
      )}
      {doc.cardType && (
        <details className="panel">
          <summary>Mandatory fields for this template</summary>
          {id && (
            <p>
              <a href={`/api/${base}upload-templates?kind=kit&general=1`}>
                Download General import kit
              </a>{" "}
              — additional template requirements are checked when generating
              cards.
            </p>
          )}
          <p>
            Organization rules always apply. You can add stricter requirements
            for this template; keep each mandatory field on its design.
          </p>
          {(doc.general
            ? generalCardFields
            : cardFieldCatalog[doc.cardType]
          ).map((f) => (
            <label className="check" key={f.key}>
              <input
                type="checkbox"
                checked={doc.requiredFields?.includes(f.key) || false}
                disabled={["name", "external_id"].includes(f.key)}
                onChange={(e) =>
                  commit({
                    ...doc,
                    requiredFields: e.target.checked
                      ? [...new Set([...(doc.requiredFields || []), f.key])]
                      : doc.requiredFields?.filter((k) => k !== f.key),
                  })
                }
              />
              {f.label}
            </label>
          ))}
        </details>
      )}
      {doc.cardType && (
        <p className="notice">
          Card type: {doc.general ? "General" : doc.cardType}. Mandatory:{" "}
          {doc.requiredFields?.join(", ") || "name, external_id"}. Configure
          rules in Organization → Card fields. Required fields must remain on
          the design. The canvas keeps all editable fields; the server preview
          applies your theme’s field visibility and card lock.
        </p>
      )}
      <div className="designer-layout">
        <aside className="panel designer-tools">
          <h3>Elements</h3>
          <div className="element-buttons">
            {(
              [
                "text",
                "photo",
                "image",
                "logo",
                "qr",
                "barcode",
                "rect",
                "ellipse",
                "line",
                "signature",
                "stamp",
                "date",
                "map",
              ] as Element["type"][]
            ).map((t) => (
              <button key={t} onClick={() => add(t)}>
                {t}
              </button>
            ))}
          </div>
          <h3>Card setup</h3>
          <label>
            Preset
            <select
              onChange={(e) => {
                if (e.target.value === "cr80")
                  commit({ ...doc, width: 85.6, height: 53.98 });
                if (e.target.value === "portrait")
                  commit({ ...doc, width: 53.98, height: 85.6 });
              }}
              defaultValue="custom"
            >
              <option value="custom">Custom</option>
              <option value="cr80">CR80 landscape</option>
              <option value="portrait">CR80 portrait</option>
            </select>
          </label>
          <label>
            Units
            <select
              value={unit}
              onChange={(e) => setUnit(e.target.value as typeof unit)}
            >
              <option value="mm">Millimetres</option>
              <option value="in">Inches</option>
              <option value="px">Pixels at selected DPI</option>
            </select>
          </label>
          <label>
            Width · {unit}
            <input
              type="number"
              min={10 / factor}
              max={500 / factor}
              step={0.01}
              value={Math.round((doc.width / factor) * 100) / 100}
              onChange={(e) =>
                commit({ ...doc, width: Number(e.target.value) * factor })
              }
            />
          </label>
          <label>
            Height · {unit}
            <input
              type="number"
              min={10 / factor}
              max={500 / factor}
              step={0.01}
              value={Math.round((doc.height / factor) * 100) / 100}
              onChange={(e) =>
                commit({ ...doc, height: Number(e.target.value) * factor })
              }
            />
          </label>
          <label>
            DPI
            <select
              value={doc.dpi}
              onChange={(e) => commit({ ...doc, dpi: Number(e.target.value) })}
            >
              {[150, 300, 600].map((n) => (
                <option key={n}>{n}</option>
              ))}
            </select>
          </label>
          <small>
            {(doc.width / 25.4).toFixed(2)} × {(doc.height / 25.4).toFixed(2)}{" "}
            inches
            <br />
            {Math.round((doc.width * doc.dpi) / 25.4)} ×{" "}
            {Math.round((doc.height * doc.dpi) / 25.4)} pixels
          </small>
          <label>
            Background
            <input
              type="color"
              value={doc.background}
              onChange={(e) => commit({ ...doc, background: e.target.value })}
            />
          </label>
          <h3>Layers</h3>
          <ul className="layers">
            {[...doc[side]].reverse().map((e) => (
              <li className={selection === e.id ? "selected" : ""} key={e.id}>
                <button onClick={() => setSelection(e.id)}>
                  {e.locked ? "▣ " : "☷ "}
                  {e.type} {e.text.slice(0, 12)}
                </button>
                <button
                  title="Move forward"
                  onClick={() => {
                    const list = [...doc[side]],
                      i = list.findIndex((x) => x.id === e.id);
                    if (i < list.length - 1) {
                      [list[i], list[i + 1]] = [list[i + 1], list[i]];
                      commit({ ...doc, [side]: list });
                    }
                  }}
                >
                  ↑
                </button>
              </li>
            ))}
          </ul>
          {versions.length > 0 && (
            <>
              <h3>Restore version</h3>
              <select
                aria-label="Version to restore"
                value={restore}
                onChange={(e) => setRestore(e.target.value)}
              >
                <option value="">Choose version</option>
                {versions.map((v) => (
                  <option key={v.id} value={v.id}>
                    Version {v.version}
                  </option>
                ))}
              </select>
              <button
                disabled={!restore || busy}
                onClick={() =>
                  void task(async () => {
                    await api(base + "templates/" + id, "PUT", {
                      restore_version_id: restore,
                    });
                    const t = await api(base + "templates/" + id);
                    loadDocument(t.document);
                    setVersions(t.versions);
                    setMessage("Restored into a new version");
                  })
                }
              >
                Restore as new version
              </button>
            </>
          )}
        </aside>
        <section className="canvas-column">
          <div className="canvas-toolbar">
            <div className="segmented">
              <button
                className={side === "front" ? "active" : ""}
                onClick={() => {
                  setSide("front");
                  setSelection("");
                }}
              >
                Front
              </button>
              <button
                className={side === "back" ? "active" : ""}
                onClick={() => {
                  setSide("back");
                  setSelection("");
                }}
              >
                Back
              </button>
            </div>
            <button disabled={!history.length} onClick={undo}>
              ↶ Undo
            </button>
            <button disabled={!future.length} onClick={redo}>
              ↷ Redo
            </button>
            <label className="check">
              <input
                type="checkbox"
                checked={snap}
                onChange={(e) => setSnap(e.target.checked)}
              />
              Snap
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={grid}
                onChange={(e) => setGrid(e.target.checked)}
              />
              Grid
            </label>
            <select
              aria-label="Zoom"
              value={zoom}
              onChange={(e) => setZoom(Number(e.target.value))}
            >
              {[0.5, 0.75, 1, 1.5, 2].map((v) => (
                <option key={v} value={v}>
                  {v * 100}%
                </option>
              ))}
            </select>
          </div>
          <div className="canvas-scroll">
            <div className="ruler">
              {Array.from(
                { length: Math.min(50, Math.ceil(doc.width / 10)) },
                (_, i) => (
                  <span style={{ width: 60 * zoom }} key={i}>
                    {i * 10}
                  </span>
                ),
              )}
            </div>
            <div className="canvas-with-rulers">
              <div className="vertical-ruler">
                {Array.from(
                  { length: Math.min(50, Math.ceil(doc.height / 10)) },
                  (_, i) => (
                    <span style={{ height: 60 * zoom }} key={i}>
                      {i * 10}
                    </span>
                  ),
                )}
              </div>
              <Stage
                ref={stage}
                width={doc.width * scale}
                height={doc.height * scale}
                scaleX={scale}
                scaleY={scale}
                onMouseDown={(e) => {
                  if (e.target === e.target.getStage()) setSelection("");
                }}
              >
                <Layer>
                  <Rect
                    width={doc.width}
                    height={doc.height}
                    fill={doc.background}
                    listening={false}
                  />
                  {grid &&
                    Array.from(
                      { length: Math.min(100, Math.ceil(doc.width / 5)) },
                      (_, i) => (
                        <Line
                          key={"x" + i}
                          points={[i * 5, 0, i * 5, doc.height]}
                          stroke="#b0bdc7"
                          opacity={0.25}
                          strokeWidth={0.1}
                          listening={false}
                        />
                      ),
                    )}
                  {grid &&
                    Array.from(
                      { length: Math.min(100, Math.ceil(doc.height / 5)) },
                      (_, i) => (
                        <Line
                          key={"y" + i}
                          points={[0, i * 5, doc.width, i * 5]}
                          stroke="#b0bdc7"
                          opacity={0.25}
                          strokeWidth={0.1}
                          listening={false}
                        />
                      ),
                    )}
                  {doc[side].map((e) => (
                    <Group
                      id={e.id}
                      key={e.id}
                      x={e.x}
                      y={e.y}
                      rotation={e.rotation}
                      width={e.width}
                      height={e.height}
                      draggable={!e.locked}
                      onClick={() => setSelection(e.id)}
                      onTap={() => setSelection(e.id)}
                      onDragEnd={(ev) => {
                        setSelection(e.id);
                        commit({
                          ...doc,
                          [side]: doc[side].map((x) =>
                            x.id === e.id
                              ? {
                                  ...x,
                                  x: position(ev.target.x()),
                                  y: position(ev.target.y()),
                                }
                              : x,
                          ),
                        });
                      }}
                      onTransformEnd={(ev) => {
                        const node = ev.target;
                        const values = {
                          x: position(node.x()),
                          y: position(node.y()),
                          width: Math.max(1, e.width * node.scaleX()),
                          height: Math.max(1, e.height * node.scaleY()),
                          rotation: Math.round(node.rotation()),
                        };
                        node.scaleX(1);
                        node.scaleY(1);
                        commit({
                          ...doc,
                          [side]: doc[side].map((x) =>
                            x.id === e.id ? { ...x, ...values } : x,
                          ),
                        });
                      }}
                    >
                      {e.type === "text" || e.type === "date" ? (
                        <Text
                          text={e.text}
                          width={e.width}
                          height={e.height}
                          fontSize={e.fontSize}
                          fontFamily={e.fontFamily}
                          fontStyle={`${e.bold ? "bold " : ""}${e.italic ? "italic" : ""}`}
                          lineHeight={1.25}
                          fill={e.fill}
                          align={e.align}
                        />
                      ) : e.type === "rect" ? (
                        <Rect
                          width={e.width}
                          height={e.height}
                          fill={e.fill}
                          stroke={e.stroke}
                          strokeWidth={e.strokeWidth}
                        />
                      ) : e.type === "ellipse" ? (
                        <Ellipse
                          x={e.width / 2}
                          y={e.height / 2}
                          radiusX={e.width / 2}
                          radiusY={e.height / 2}
                          fill={e.fill}
                          stroke={e.stroke}
                          strokeWidth={e.strokeWidth}
                        />
                      ) : e.type === "line" ? (
                        <Line
                          points={[0, 0, e.width, e.height]}
                          stroke={e.stroke}
                          strokeWidth={e.strokeWidth || 0.3}
                        />
                      ) : e.type === "qr" || e.type === "barcode" ? (
                        <>
                          <Rect
                            width={e.width}
                            height={e.height}
                            fill={e.background}
                            stroke="#9baebc"
                            strokeWidth={0.2}
                          />
                          <Text
                            text={e.type === "qr" ? "▦ QR" : "▥ BARCODE"}
                            fontSize={3}
                            fill={e.fill}
                            width={e.width}
                            height={e.height}
                            align="center"
                            verticalAlign="middle"
                          />
                        </>
                      ) : (
                        <AssetImage element={e} org={org} />
                      )}
                    </Group>
                  ))}
                  <Transformer
                    ref={transformer}
                    flipEnabled={false}
                    rotateEnabled
                    anchorSize={7}
                    borderStroke="#0a7883"
                    anchorStroke="#0a7883"
                    boundBoxFunc={(old, box) =>
                      box.width < 6 || box.height < 6 ? old : box
                    }
                  />
                </Layer>
              </Stage>
            </div>
          </div>
          <p className="muted canvas-help">
            Choose a language and font for each text field. Use the
            authoritative preview to check complex scripts and uploaded fonts
            before printing. Measurements in mm · Drag to place · Select to
            resize or rotate · Ctrl/Cmd+C/V to copy/paste
          </p>
          <section className="panel">
            <h3>Authoritative render preview</h3>
            <p className="muted">
              The canvas shows binding labels and code placeholders. Preview
              resolves them with real data using the server renderer.
            </p>
            <div className="toolbar">
              <select
                aria-label="Preview person"
                value={person}
                onChange={(e) => setPerson(e.target.value)}
              >
                <option value="">Choose person</option>
                {people
                  .filter(
                    (p) =>
                      !variants || p.custom_fields?.card_type === doc.cardType,
                  )
                  .map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.external_id} · {p.name}
                    </option>
                  ))}
              </select>
              <button
                disabled={!person || busy}
                onClick={() =>
                  void task(async () => {
                    const blob = await api(base + "preview", "POST", {
                      document: sharedDocument(),
                      person_id: person,
                      side,
                      theme_key: themeKey,
                    });
                    setPreview(URL.createObjectURL(blob));
                  })
                }
              >
                Render {side}
              </button>
            </div>
            {preview && (
              <img
                className="card-preview"
                alt="Server-rendered card preview"
                src={preview}
              />
            )}
          </section>
        </section>
        <aside className="panel properties">
          <h3>
            {selected ? `${selected.type} properties` : "Element properties"}
          </h3>
          {selected ? (
            <>
              <div className="toolbar">
                <button onClick={duplicate}>Duplicate</button>
                <button disabled={selected.locked} onClick={remove}>
                  Delete
                </button>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={selected.locked}
                  onChange={(e) => update({ locked: e.target.checked })}
                />
                Lock element
              </label>
              {(["x", "y", "width", "height", "rotation"] as const).map(
                (key) => (
                  <label key={key}>
                    {key}
                    {key === "rotation" ? " · degrees" : " · mm"}
                    <input
                      type="number"
                      step={0.1}
                      value={selected[key]}
                      onChange={(e) =>
                        update({ [key]: Number(e.target.value) })
                      }
                    />
                  </label>
                ),
              )}
              <div className="toolbar">
                <button
                  onClick={() =>
                    update({ x: (doc.width - selected.width) / 2 })
                  }
                >
                  Center X
                </button>
                <button
                  onClick={() =>
                    update({ y: (doc.height - selected.height) / 2 })
                  }
                >
                  Center Y
                </button>
                <button onClick={() => update({ x: 0 })}>Left</button>
                <button onClick={() => update({ y: 0 })}>Top</button>
                <button
                  onClick={() => update({ x: doc.width - selected.width })}
                >
                  Right
                </button>
                <button
                  onClick={() => update({ y: doc.height - selected.height })}
                >
                  Bottom
                </button>
              </div>
              {["text", "date", "qr", "barcode"].includes(selected.type) && (
                <label>
                  Text / dynamic binding
                  <textarea
                    rows={3}
                    value={selected.text}
                    onChange={(e) => update({ text: e.target.value })}
                  />
                </label>
              )}
              {["text", "date"].includes(selected.type) && (
                <>
                  <label>
                    Font
                    <select
                      value={selected.fontFamily}
                      onChange={(e) =>
                        update({
                          fontFamily: e.target.value as Element["fontFamily"],
                          fontOverride: true,
                        })
                      }
                    >
                      {fontNames.map((f) => (
                        <option key={f}>{f}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Text language
                    <select
                      value={selected.language || "en"}
                      onChange={(e) => update({ language: e.target.value })}
                    >
                      {printLanguages.map((l) => (
                        <option key={l.code} value={l.code}>
                          {l.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Font size · mm
                    <input
                      type="number"
                      min={1}
                      max={100}
                      step={0.1}
                      value={selected.fontSize}
                      onChange={(e) =>
                        update({ fontSize: Number(e.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Alignment
                    <select
                      value={selected.align}
                      onChange={(e) =>
                        update({ align: e.target.value as Element["align"] })
                      }
                    >
                      <option>left</option>
                      <option>center</option>
                      <option>right</option>
                    </select>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={selected.bold}
                      onChange={(e) => update({ bold: e.target.checked })}
                    />
                    Bold
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={selected.italic}
                      onChange={(e) => update({ italic: e.target.checked })}
                    />
                    Italic
                  </label>
                </>
              )}
              <label>
                Fill
                <input
                  type="color"
                  value={selected.fill}
                  onChange={(e) => update({ fill: e.target.value })}
                />
              </label>
              <label>
                Stroke
                <input
                  type="color"
                  value={selected.stroke}
                  onChange={(e) => update({ stroke: e.target.value })}
                />
              </label>
              <label>
                Stroke width · mm
                <input
                  type="number"
                  min={0}
                  step={0.1}
                  value={selected.strokeWidth}
                  onChange={(e) =>
                    update({ strokeWidth: Number(e.target.value) })
                  }
                />
              </label>
              {["image", "logo", "signature", "stamp", "photo", "map"].includes(
                selected.type,
              ) && (
                <>
                  <label>
                    Image source
                    <select
                      value={selected.assetField || ""}
                      onChange={(e) =>
                        update({
                          assetField: (e.target.value ||
                            undefined) as Element["assetField"],
                        })
                      }
                    >
                      <option value="">Selected image / matched photo</option>
                      <option value="cardholder_signature">
                        Person’s signature
                      </option>
                      <option value="authorized_signature">
                        Card type’s authorized signature
                      </option>
                      <option value="organization_logo">
                        Card type’s organization logo
                      </option>
                    </select>
                  </label>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={selected.optional || false}
                      onChange={(e) => update({ optional: e.target.checked })}
                    />
                    Allow missing image when field is optional
                  </label>
                  <label>
                    Image asset
                    <select
                      value={selected.assetId || ""}
                      onChange={(e) =>
                        update({ assetId: e.target.value || undefined })
                      }
                    >
                      <option value="">
                        {selected.type === "photo"
                          ? "Person’s matched photo"
                          : "Choose asset"}
                      </option>
                      {assets.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.kind} · {a.id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                  </label>
                  {selected.type === "photo" && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const size = Math.min(
                            selected.width,
                            selected.height,
                          );
                          update({ width: size, height: size, fit: "cover" });
                        }}
                      >
                        Square photo
                      </button>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={selected.faceFit}
                          onChange={(e) =>
                            update({ faceFit: e.target.checked })
                          }
                        />
                        Automatically frame the face
                      </label>
                      <p className="muted">
                        Photos automatically fill the frame without stretching.
                        Use Square photo for an equal-width-and-height frame.
                      </p>
                    </>
                  )}
                  <label>
                    Fit
                    <select
                      aria-label="Image fitting"
                      value={selected.fit}
                      onChange={(e) =>
                        update({ fit: e.target.value as Element["fit"] })
                      }
                    >
                      <option value="cover">
                        Auto fill frame (crop edges)
                      </option>
                      <option value="contain">Fit whole image</option>
                    </select>
                  </label>
                  <label>
                    Upload image
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file)
                          void task(async () => {
                            const a = await api(
                              base + "assets?kind=IMAGE",
                              "POST",
                              file,
                              true,
                            );
                            update({ assetId: a.id });
                            setAssets(await api(base + "assets"));
                          });
                      }}
                    />
                  </label>
                </>
              )}
              {selected.type === "barcode" && (
                <label>
                  Barcode format
                  <select
                    value={selected.barcode}
                    onChange={(e) =>
                      update({ barcode: e.target.value as Element["barcode"] })
                    }
                  >
                    {["code128", "code39", "ean13", "ean8", "upca", "upce"].map(
                      (c) => (
                        <option key={c}>{c}</option>
                      ),
                    )}
                  </select>
                </label>
              )}
              {selected.type === "qr" && (
                <>
                  <label>
                    Error correction
                    <select
                      value={selected.errorCorrection}
                      onChange={(e) =>
                        update({
                          errorCorrection: e.target
                            .value as Element["errorCorrection"],
                        })
                      }
                    >
                      {["L", "M", "Q", "H"].map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Code background
                    <input
                      type="color"
                      value={selected.background}
                      onChange={(e) => update({ background: e.target.value })}
                    />
                  </label>
                </>
              )}
            </>
          ) : (
            <p className="muted">
              Select an element on the canvas or add one from the left.
            </p>
          )}
          <hr />
          <small>
            Bindings: {"{{name}}"}, {"{{external_id}}"}, {"{{email}}"},{" "}
            {"{{phone}}"}, {"{{designation}}"}, {"{{card.number}}"},{" "}
            {"{{card.verify_url}}"}, {"{{card.date}}"}, or a custom field key.
          </small>
        </aside>
      </div>
    </div>
  );
}
