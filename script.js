var map = L.map('map').setView(
[41.986,-73.619],
25
);


L.tileLayer(
'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
{
attribution:'© OpenStreetMap'
}
).addTo(map);



L.marker([41.986,-73.619])
.addTo(map)
.bindPopup(
"<b>Main Herd</b><br>" +
"North Pasture<br>" +
"August 5, 2026<br>" +
"8:00 AM"
)
.openPopup();
