import { elementSchema, templateSchema } from "./template.ts";
export function starterTemplate(name: string, logoId?: string) {
  const el = (v: Record<string, unknown>) =>
    elementSchema.parse({
      id: crypto.randomUUID(),
      x: 5,
      y: 5,
      width: 50,
      height: 10,
      ...v,
    });
  return templateSchema.parse({
    schemaVersion: 1,
    width: 85.6,
    height: 53.98,
    front: [
      el({
        type: "rect",
        x: 0,
        y: 0,
        width: 85.6,
        height: 13,
        fill: "#086b73",
      }),
      el({
        type: "text",
        text: name.slice(0, 32),
        x: logoId ? 18 : 5,
        y: 4,
        width: 62,
        height: 7,
        fontSize: 3,
        fill: "#ffffff",
      }),
      ...(logoId
        ? [
            el({
              type: "logo",
              assetId: logoId,
              x: 3,
              y: 2,
              width: 10,
              height: 9,
            }),
          ]
        : []),
      el({ type: "photo", x: 5, y: 18, width: 20, height: 28 }),
      el({
        type: "text",
        text: "{{name}}",
        x: 29,
        y: 18,
        width: 50,
        height: 10,
        fontSize: 3.5,
      }),
      el({
        type: "text",
        text: "ID: {{external_id}}",
        x: 29,
        y: 31,
        width: 50,
        height: 8,
        fontSize: 3,
      }),
    ],
    back: [
      el({
        type: "text",
        text: "Scan to check current card status",
        x: 5,
        y: 4,
        width: 75,
        height: 8,
        fontSize: 3,
      }),
      el({
        type: "qr",
        text: "{{card.verify_url}}",
        x: 29,
        y: 16,
        width: 26,
        height: 26,
      }),
      el({
        type: "text",
        text: "{{card.number}}",
        x: 5,
        y: 44,
        width: 75,
        height: 7,
        fontSize: 2.5,
      }),
    ],
  });
}
