// Default starter content. All of this is fully editable/removable in Parent Mode.
function mvssUid(prefix) {
  return (prefix || "id") + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function mvssButton(label, phrase, emoji, extra) {
  return Object.assign(
    {
      id: mvssUid("btn"),
      label,
      phrase,
      emoji,
      imageFileId: null,
      audioFileId: null,
      color: null,
      hidden: false,
    },
    extra || {}
  );
}

function mvssDefaultVoiceCategories() {
  return [
    {
      id: "food",
      name: "Food and Drink",
      color: "#f59e0b",
      priority: false,
      buttons: [
        mvssButton("Water", "Water, please.", "💧"),
        mvssButton("Drink", "I want a drink.", "🥤"),
        mvssButton("Snack", "I want a snack.", "🍪"),
        mvssButton("Crisps", "Crisps, please.", "🍟"),
        mvssButton("Breakfast", "I want breakfast.", "🥣"),
        mvssButton("Lunch", "I want lunch.", "🥪"),
        mvssButton("Dinner", "I want dinner.", "🍽️"),
        mvssButton("More", "More, please.", "➕"),
        mvssButton("Finished", "I am finished.", "✅"),
        mvssButton("Hungry", "I am hungry.", "😋"),
        mvssButton("Thirsty", "I am thirsty.", "🥵"),
      ],
    },
    {
      id: "needs",
      name: "Personal Needs",
      color: "#ef4444",
      priority: true,
      buttons: [
        mvssButton("Toilet", "I need the toilet.", "🚻"),
        mvssButton("Help", "Please help me.", "🆘"),
        mvssButton("Stop", "Stop.", "✋"),
        mvssButton("Break", "I need a break.", "⏸️"),
        mvssButton("Quiet", "I need quiet.", "🤫"),
        mvssButton("I feel unwell", "I feel unwell.", "🤒"),
        mvssButton("Something hurts", "Something hurts.", "🩹"),
        mvssButton("Too loud", "It is too loud.", "📢"),
        mvssButton("Too bright", "It is too bright.", "💡"),
        mvssButton("I need space", "I need some space.", "🫧"),
      ],
    },
    {
      id: "tv",
      name: "I want to watch",
      color: "#8b5cf6",
      priority: false,
      buttons: [
        mvssButton("Blippi", "I want to watch Blippi.", "📺"),
        mvssButton("Football", "I want to watch football.", "⚽"),
        mvssButton("Water slides", "I want to watch water slides.", "🛝"),
        mvssButton("Cartoons", "I want to watch cartoons.", "🎬"),
        mvssButton("Music", "I want to watch music.", "🎵"),
        mvssButton("My favourite programme", "I want to watch my favourite programme.", "⭐"),
        mvssButton("Something else", "I want to watch something else.", "❓"),
        mvssButton("No television", "No television, please.", "🚫"),
        mvssButton("Finished watching", "I am finished watching.", "✅"),
      ],
    },
    {
      id: "feelings",
      name: "Feelings",
      color: "#10b981",
      priority: false,
      buttons: [
        mvssButton("Happy", "I feel happy.", "😀"),
        mvssButton("Sad", "I feel sad.", "😢"),
        mvssButton("Angry", "I feel angry.", "😠"),
        mvssButton("Worried", "I feel worried.", "😟"),
        mvssButton("Tired", "I feel tired.", "😴"),
        mvssButton("Excited", "I feel excited.", "🤩"),
        mvssButton("Calm", "I feel calm.", "😌"),
        mvssButton("Uncomfortable", "I feel uncomfortable.", "😣"),
        mvssButton("I do not know", "I do not know.", "🤷"),
      ],
    },
    {
      id: "answers",
      name: "Answers and Choices",
      color: "#3b82f6",
      priority: false,
      buttons: [
        mvssButton("Yes", "Yes.", "👍"),
        mvssButton("No", "No.", "👎"),
        mvssButton("Maybe", "Maybe.", "🤔"),
        mvssButton("This one", "This one.", "👉"),
        mvssButton("Not this one", "Not this one.", "🚫"),
        mvssButton("More", "More, please.", "➕"),
        mvssButton("Finished", "Finished.", "✅"),
        mvssButton("Again", "Again, please.", "🔁"),
        mvssButton("Different", "Something different.", "🔀"),
        mvssButton("Wait", "Wait, please.", "⏳"),
      ],
    },
  ];
}

function mvssDefaultWordsActions() {
  return [
    mvssButton("Hi", "Hi.", "👋", { anim: "wave" }),
    mvssButton("Bye", "Bye.", "👋", { anim: "wave" }),
    mvssButton("Please", "Please.", "🙏", { anim: "pulse" }),
    mvssButton("Thank you", "Thank you.", "🙏", { anim: "pulse" }),
    mvssButton("Yes", "Yes.", "👍", { anim: "bounce" }),
    mvssButton("No", "No.", "👎", { anim: "shake" }),
    mvssButton("Help", "I need help.", "🆘", { anim: "pulse" }),
    mvssButton("Stop", "Stop.", "✋", { anim: "bounce" }),
    mvssButton("Wait", "Wait.", "⏳", { anim: "pulse" }),
    mvssButton("Come here", "Come here.", "🤗", { anim: "bounce" }),
    mvssButton("My turn", "It is my turn.", "☝️", { anim: "bounce" }),
    mvssButton("Your turn", "It is your turn.", "👉", { anim: "bounce" }),
    mvssButton("Sorry", "Sorry.", "😔", { anim: "pulse" }),
    mvssButton("Well done", "Well done!", "🌟", { anim: "bounce" }),
    mvssButton("Again", "Again.", "🔁", { anim: "spin" }),
    mvssButton("Finished", "Finished.", "✅", { anim: "pulse" }),
    mvssButton("Good morning", "Good morning.", "🌞", { anim: "pulse" }),
    mvssButton("Good night", "Good night.", "🌙", { anim: "pulse" }),
    mvssButton("Mum", "Mum.", "👩", { anim: "wave" }),
    mvssButton("Dad", "Dad.", "👨", { anim: "wave" }),
    mvssButton("Family", "Family.", "👨‍👩‍👧‍👦", { anim: "pulse" }),
    mvssButton("Friend", "Friend.", "🧑‍🤝‍🧑", { anim: "pulse" }),
  ];
}

function mvssDefaultPhotoCategories() {
  return [
    "Family",
    "Happy memories",
    "Favourite places",
    "Football",
    "Water slides",
    "Television programmes",
    "School",
    "People I know",
    "Things that make me calm",
    "My routines",
  ].map((name) => ({ id: mvssUid("cat"), name }));
}
