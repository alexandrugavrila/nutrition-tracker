// Simplified API client to avoid reliance on external fetch library.
// Supports the minimal `path().method().create()` interface used by the app.

type HTTPMethod = "get" | "post" | "put" | "patch" | "delete";

export class ApiClient {
  constructor(private request: typeof fetch = (...args) => fetch(...args)) {}
  private baseUrl = "";

  configure({ baseUrl }: { baseUrl: string }) {
    this.baseUrl = baseUrl;
  }

  path(path: string) {
    const url = `${this.baseUrl}${path}`;
    return {
      method: (method: HTTPMethod) => ({
        create: () =>
          async (options: { body?: unknown } = {}) => {
            const { body } = options;
            const response = await this.request(url, {
              method: method.toUpperCase(),
              credentials: "include",
              headers: body
                ? { "Content-Type": "application/json" }
                : undefined,
              body: body ? JSON.stringify(body) : undefined,
            });

            // Try to parse JSON only when present; fall back to text
            const contentType = response.headers.get("content-type") || "";
            let parsed: unknown;
            try {
              if (contentType.includes("application/json")) {
                parsed = await response.json();
              } else {
                const text = await response.text();
                parsed = text.length ? text : null;
              }
            } catch (error) {
              // DOMException is not an Error in every browser realm. Only malformed
              // JSON may be ignored; cancellation and other read failures must escape.
              if (!error || typeof error !== "object" || !("name" in error) || error.name !== "SyntaxError") throw error;
              // Ignore JSON parse errors for empty/error responses
              parsed = null;
            }

            if (!response.ok) {
              const statusText = response.statusText || "Request failed";
              let detail: unknown = parsed;
              if (parsed !== null && typeof parsed === "object" && "detail" in parsed) {
                detail = (parsed as { detail: unknown }).detail;
              }
              const error = new Error(
                `${response.status} ${statusText}${detail ? `: ${detail}` : ""}`,
              );
              throw error;
            }

            return { data: parsed } as { data: unknown };
          },
      }),
    };
  }
}

export const apiClient = new ApiClient();
apiClient.configure({ baseUrl: "" });

export default apiClient;
