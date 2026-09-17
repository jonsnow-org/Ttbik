export default function MiniAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl">
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
        <script src="https://telegram.org/js/telegram-web-app.js" />
      </head>
      <body className="bg-[#17212b] text-white">{children}</body>
    </html>
  );
}
