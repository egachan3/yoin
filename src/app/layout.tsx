import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
	title: "Yoin",
	description: "観た・読んだ・聴いたものの余韻を、棚に並べる。",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<html lang="ja">
			<head>
				<link rel="icon" href="/favicon.svg" type="image/svg+xml"></link>
			</head>
			<body>{children}</body>
		</html>
	);
}
