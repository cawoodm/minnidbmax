"use strict";

const apiServer = "https://api.github.com";
export const Gist = function (token) {
  return {
    async request(config) {
      const uri = config.url.startsWith("http") ? config.url : apiServer + config.url;
      return await fetch(uri, {
        ...config,
        body: JSON.stringify(config.data),
        headers: {
          ...this._authHeader(),
          ...config?.headers,
          "User-Agent": "Gist-Client",
        },
      });
    },

    async get(url, config = {}) {
      return this.request({ ...config, method: "GET", url });
    },

    delete(url, config = {}) {
      return this.request({ ...config, method: "DELETE", url });
    },

    post(url, data = undefined, config = {}) {
      return this.request({ ...config, method: "POST", url, data });
    },

    put(url, data = undefined, config = {}) {
      return this.request({ ...config, method: "PUT", url, data });
    },

    patch(url, data = undefined, config = {}) {
      return this.request({ ...config, method: "PATCH", url, data });
    },

    create(data, conf) {
      return this.post("/gists", data, conf);
    },

    update(gistId, data, conf = {}) {
      return this.patch(`/gists/${gistId}`, data, { headers: { Accept: "application/vnd.github+jso", ...conf } });
    },

    async getOne(gistId, conf) {
      return this.get(`/gists/${gistId}`, conf);
    },

    delOne(gistId, conf) {
      return this.delete(`/gists/${gistId}`, conf);
    },

    _authHeader() {
      return token
        ? {
            Authorization: `Bearer ${token}`,
          }
        : {};
    },
  };
};
