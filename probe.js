const axios = require('axios');
(async () => {
    let url = 'https://snap.fan/api/cards/';
    let cards = [];
    while (url) {
        console.log("Fetching", url);
        const res = await axios.get(url);
        cards = cards.concat(res.data.results);
        url = res.data.next;
    }
    console.log("Total cards:", cards.length);
    console.log("Adam Warlock:", cards.find(c => c.name === 'Adam Warlock'));
})();
