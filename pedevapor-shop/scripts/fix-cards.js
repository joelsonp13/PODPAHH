/* Diagnóstico: onde estao os 32 cards? */
const fs = require('fs');
const p = 'c:/Users/Natanael/Documents/podpahh/pedevapor-shop/pages/categoria-produto/descartaveis.html';
const s = fs.readFileSync(p, 'utf8');

const re = /<div class="subcat-card" /g;
let m, positions = [];
while ((m = re.exec(s)) !== null) positions.push(m.index);
console.log('cards no arquivo:', positions.length);

// Verifica se ha <template ou display:none em volta
for (let i = 0; i < positions.length; i++) {
  const before = s.slice(Math.max(0, positions[i] - 200), positions[i]);
  const hasTemplate = before.lastIndexOf('<template') > before.lastIndexOf('</template>');
  const hasNoscript = before.lastIndexOf('<noscript') > before.lastIndexOf('</noscript>');
  if (hasTemplate || hasNoscript) {
    console.log('card', i, 'esta dentro de', hasTemplate ? '<template>' : '<noscript>');
  }
}

// imprime contexto dos cards 11, 12, 13 (fronteiras)
for (const idx of [11, 12, 13]) {
  if (positions[idx] !== undefined) {
    const line = s.slice(0, positions[idx]).split('\n').length;
    console.log('card', idx, 'esta na linha', line);
  }
}
