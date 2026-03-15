# TODO

## Photo Hosting

Currently photos are stored locally and the CSV export leaves the photo URL column blank.
Need to pick a hosting solution and wire it up to `SERVER_BASE_URL` in settings.

Options to evaluate:
- **Cloudflare Tunnel** — no open ports, tunnels port 8000 to a public URL, free tier available
- **Imgur upload** — upload each photo to Imgur on approve, store the Imgur URL on the listing
- **Google Drive** — upload to a shared folder, use the direct file URL
- **Backblaze B2 + Cloudflare** — cheap object storage with free egress via Cloudflare
- **Port-forward** — simplest if you're okay exposing port 8000 on your router

Whatever is chosen, the flow would be: on listing approval → upload cover photo → store public URL → include in CSV export.

---

## General

- [ ] Bulk approve listings from the dashboard (select multiple → approve all)
- [ ] Delete a batch/listing
- [ ] Search/filter dashboard by title or label
- [ ] Pagination on the dashboard queue (currently capped at 100)
- [ ] Re-order photos within a batch after upload
- [ ] Dark/light theme toggle
