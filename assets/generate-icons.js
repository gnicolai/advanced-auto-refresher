// Icon Generator - Run with Node.js
// Requires: npm install canvas

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

function drawIcon(size) {
    const canvas = createCanvas(size, size);
    const ctx = canvas.getContext('2d');
    const center = size / 2;
    const radius = size * 0.35;

    // Background circle with gradient
    const bgGrad = ctx.createLinearGradient(0, 0, size, size);
    bgGrad.addColorStop(0, '#6366f1');
    bgGrad.addColorStop(1, '#8b5cf6');

    ctx.beginPath();
    ctx.arc(center, center, size * 0.45, 0, Math.PI * 2);
    ctx.fillStyle = bgGrad;
    ctx.fill();

    // Refresh arrows
    ctx.strokeStyle = 'white';
    ctx.lineWidth = Math.max(1, size * 0.08);
    ctx.lineCap = 'round';

    // Top arrow arc
    ctx.beginPath();
    ctx.arc(center, center, radius, -Math.PI * 0.8, Math.PI * 0.1);
    ctx.stroke();

    // Bottom arrow arc
    ctx.beginPath();
    ctx.arc(center, center, radius, Math.PI * 0.2, Math.PI * 1.1);
    ctx.stroke();

    // Arrow heads
    const arrowSize = size * 0.15;

    // Top arrow head
    const topAngle = Math.PI * 0.1;
    const topX = center + radius * Math.cos(topAngle);
    const topY = center + radius * Math.sin(topAngle);
    ctx.beginPath();
    ctx.moveTo(topX + arrowSize * 0.5, topY - arrowSize * 0.8);
    ctx.lineTo(topX, topY);
    ctx.lineTo(topX - arrowSize * 0.3, topY - arrowSize * 0.6);
    ctx.stroke();

    // Bottom arrow head  
    const bottomAngle = Math.PI * 1.1;
    const bottomX = center + radius * Math.cos(bottomAngle);
    const bottomY = center + radius * Math.sin(bottomAngle);
    ctx.beginPath();
    ctx.moveTo(bottomX - arrowSize * 0.5, bottomY + arrowSize * 0.8);
    ctx.lineTo(bottomX, bottomY);
    ctx.lineTo(bottomX + arrowSize * 0.3, bottomY + arrowSize * 0.6);
    ctx.stroke();

    // Center clock (for larger sizes)
    if (size >= 32) {
        ctx.beginPath();
        ctx.arc(center, center, size * 0.06, 0, Math.PI * 2);
        ctx.fillStyle = 'white';
        ctx.fill();

        ctx.lineWidth = Math.max(1, size * 0.04);
        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.lineTo(center, center - size * 0.12);
        ctx.stroke();

        ctx.beginPath();
        ctx.moveTo(center, center);
        ctx.lineTo(center + size * 0.08, center);
        ctx.stroke();
    }

    return canvas;
}

// Generate icons
const assetsDir = __dirname;

[16, 48, 128].forEach(size => {
    const canvas = drawIcon(size);
    const buffer = canvas.toBuffer('image/png');
    const filename = path.join(assetsDir, `icon${size}.png`);
    fs.writeFileSync(filename, buffer);
    console.log(`Generated: ${filename}`);
});

console.log('All icons generated!');
