/// <reference path="../pb_data/types.d.ts" />
migrate((app) => {
  const lessons = app.findCollectionByNameOrId("learning_lessons");

  const addTextField = (name) => {
    if (!lessons.fields.getByName(name)) {
      lessons.fields.add(new TextField({ name, required: false }));
    }
  };

  const addJsonField = (name) => {
    if (!lessons.fields.getByName(name)) {
      lessons.fields.add(new JSONField({ name, required: false, maxSize: 0 }));
    }
  };

  if (!lessons.fields.getByName("has_unpublished_changes")) {
    lessons.fields.add(new BoolField({ name: "has_unpublished_changes", required: false }));
  }

  [
    "draft_title",
    "draft_description",
    "draft_content_type",
    "draft_video_url",
    "draft_text_content",
    "draft_material_url",
    "draft_pdf_url",
    "draft_download_url",
  ].forEach(addTextField);

  addJsonField("draft_rich_content");
  addJsonField("draft_attachments");

  app.save(lessons);
}, (app) => {
  const lessons = app.findCollectionByNameOrId("learning_lessons");
  [
    "has_unpublished_changes",
    "draft_title",
    "draft_description",
    "draft_content_type",
    "draft_video_url",
    "draft_text_content",
    "draft_rich_content",
    "draft_material_url",
    "draft_pdf_url",
    "draft_download_url",
    "draft_attachments",
  ].forEach((fieldName) => {
    if (lessons.fields.getByName(fieldName)) {
      lessons.fields.removeByName(fieldName);
    }
  });
  app.save(lessons);
});
