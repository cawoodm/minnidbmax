import { jsPanel } from "jspanel4/es6module/jspanel.js";

export type AlertType = "success" | "error" | "info";

const themeMap: Record<AlertType, string> = {
  success: "success",
  error: "danger",
  info: "info",
};

export function showAlert(message: string, type: AlertType = "success", headerTitle = "Notice"): void {
  (jsPanel as any).hint.create({
    headerTitle,
    content: `<div style="padding:10px 14px;">${message}</div>`,
    theme: themeMap[type],
    position: "center-top 0 15 down",
    panelSize: { width: 320, height: "auto" },
    autoclose: 5000,
  });
}
