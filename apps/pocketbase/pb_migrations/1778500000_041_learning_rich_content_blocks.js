/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const lessons = app.findCollectionByNameOrId("learning_lessons");

  if (!lessons.fields.getByName("rich_content")) {
    lessons.fields.add(new JSONField({
      name: "rich_content",
      required: false,
      maxSize: 0,
    }));
    app.save(lessons);
  }

  const lessonRecords = app.findRecordsByFilter("learning_lessons", "", "position,title");
  for (const lesson of lessonRecords) {
    const current = lesson.get("rich_content");
    if (Array.isArray(current) && current.length > 0) {
      continue;
    }

    const textContent = String(lesson.get("text_content") || "").trim();
    if (!textContent) {
      continue;
    }

    const blocks = textContent
      .split(/\n{2,}/)
      .map((text, index) => ({
        id: `legacy_text_${index}`,
        type: "paragraph",
        text: text.trim(),
        size: index === 0 ? "large" : "normal",
        bold: false,
      }))
      .filter((block) => block.text);

    if (blocks.length > 0) {
      lesson.set("rich_content", blocks);
      app.save(lesson);
    }
  }
}, (app) => {
  const lessons = app.findCollectionByNameOrId("learning_lessons");
  if (lessons.fields.getByName("rich_content")) {
    lessons.fields.removeByName("rich_content");
    app.save(lessons);
  }
});
