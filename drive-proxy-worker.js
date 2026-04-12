addEventListener("fetch", (event) => {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  const corsHeaders = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
    "Access-Control-Allow-Headers": "Range, Content-Type",
    "Access-Control-Expose-Headers": "Content-Length, Content-Range, Accept-Ranges",
  };

  try {
    // Handle preflight before any other logic.
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // 1) Extract Google Drive file ID from query parameter
    const url = new URL(request.url);
    const fileId = url.searchParams.get("id");
    if (!fileId) {
      return new Response("Missing file ID. Usage: ?id=YOUR_FILE_ID", {
        status: 400,
        headers: {
          "Content-Type": "text/plain",
          ...corsHeaders,
        },
      });
    }

    // 2) Build Google Drive direct download URL
    const driveUrl = `https://drive.google.com/uc?export=download&id=${fileId}`;

    // 3) Forward range request for streaming
    const range = request.headers.get("Range");
    const driveHeaders = new Headers();
    if (range) driveHeaders.set("Range", range);

    // 4) Fetch from Google Drive (follow redirects)
    let driveResponse = await fetch(driveUrl, {
      headers: driveHeaders,
      redirect: "follow",
    });

    // 5) Explicit redirect handling for confirmation redirects
    if (driveResponse.status === 302 || driveResponse.status === 303) {
      const redirectUrl = driveResponse.headers.get("Location");
      if (redirectUrl) {
        driveResponse = await fetch(redirectUrl, {
          headers: driveHeaders,
          redirect: "follow",
        });
      }
    }

    // 6) Drive error passthrough
    if (!driveResponse.ok && driveResponse.status !== 206) {
      console.error(`Drive API error: ${driveResponse.status}`);
      return new Response(`Drive file not accessible: ${driveResponse.statusText}`, {
        status: driveResponse.status,
        headers: {
          "Content-Type": "text/plain",
          ...corsHeaders,
        },
      });
    }

    // 7) Build proxy response headers
    const responseHeaders = new Headers(corsHeaders);
    const contentType = driveResponse.headers.get("Content-Type");
    responseHeaders.set("Content-Type", contentType || "video/mp4");

    const contentLength = driveResponse.headers.get("Content-Length");
    const contentRange = driveResponse.headers.get("Content-Range");
    const acceptRanges = driveResponse.headers.get("Accept-Ranges");
    if (contentLength) responseHeaders.set("Content-Length", contentLength);
    if (contentRange) responseHeaders.set("Content-Range", contentRange);
    responseHeaders.set("Accept-Ranges", acceptRanges || "bytes");

    // 8) Cache for performance
    responseHeaders.set("Cache-Control", "public, max-age=3600");

    // 9) Return stream
    return new Response(driveResponse.body, {
      status: driveResponse.status,
      statusText: driveResponse.statusText,
      headers: responseHeaders,
    });
  } catch (error) {
    console.error("Worker error:", error);
    return new Response(`Proxy error: ${error.message}`, {
      status: 503,
      headers: {
        "Content-Type": "text/plain",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}
