/// <reference path="../pb_data/types.d.ts" />

const QUALITY_VERIFICATION_CONDITIONS = new Set(["Neu", "Wie neu"]);

const normalizeText = (value) => String(value || "").trim();

const isAdminRequest = (e) => {
  const auth = e.auth || (e.requestInfo && e.requestInfo.auth);
  return auth && auth.get && auth.get("is_admin") === true;
};

const isAlreadyApprovedProduct = (recordId) => {
  if (!recordId) return false;

  try {
    const existing = $app.findRecordById("products", recordId);
    return existing && normalizeText(existing.get("verification_status")) === "approved";
  } catch (_) {
    return false;
  }
};

const protectQualityListingPublication = (e) => {
  if (isAdminRequest(e)) {
    return e.next();
  }

  const condition = normalizeText(e.record.get("condition"));
  if (!QUALITY_VERIFICATION_CONDITIONS.has(condition)) {
    return e.next();
  }

  const verificationStatus = normalizeText(e.record.get("verification_status"));
  const recordId = e.record.id || e.record.get("id");
  if (verificationStatus === "approved" && isAlreadyApprovedProduct(recordId)) {
    return e.next();
  }

  if (verificationStatus === "pending") {
    e.record.set("status", "pending_verification");
    e.record.set("verification_status", "pending");
    return e.next();
  }

  if (verificationStatus === "needs_correction") {
    e.record.set("status", "draft");
    e.record.set("verification_status", "needs_correction");
    return e.next();
  }

  e.record.set("status", "draft");
  e.record.set("verification_status", "pending_payment");
  return e.next();
};

onRecordCreateRequest(protectQualityListingPublication, "products");
onRecordUpdateRequest(protectQualityListingPublication, "products");
