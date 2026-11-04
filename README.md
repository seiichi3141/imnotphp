# I'm not PHP.

URLに `.php` が付いているのに、PHPを一切使用していないジョークサイトです。

https://blog.seiichirou.jp/imnotphp/index.php/

## しくみ

`index.php` は実行ファイルではなく**フォルダ**で、中身は静的な `index.html` です。
ページ内で動く「PHPっぽいもの」は、PHPの文法の一部を参考にしたJavaScript製の独自実装で、PHP本体の実装は流用していません。

NECのルーター「Aterm」の設定画面のURLをめぐる話題から着想したパロディです。
NECプラットフォームズおよびAtermとは一切関係ありません。
