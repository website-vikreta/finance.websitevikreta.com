import { createCn } from "cn/config"

// Teach the merger our DESIGN.md type tokens; otherwise `text-caption` reads as a color
// and gets dropped whenever a color class (text-muted-foreground, ...) sits beside it.
export const cn = createCn({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display-xl", "display-lg", "display-md", "display-sm", "title-lg", "title-md", "title-sm", "stat", "body-md", "body-sm", "caption", "micro", "eyebrow", "code"] }],
    },
  },
})
