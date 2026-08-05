var map = L.map('map').setView(
[41.986,-73.619],
16
);


L.tileLayer(
'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
{
attribution:'© OpenStreetMap'
}
).addTo(map);
